import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import type {
  FetchLike,
  MemberResult,
  NotificationEnvelope,
  NotificationOptions,
  NotificationStatus,
  OnboardingNotification,
  ReconcileSummary
} from './types.js';

export const DEFAULT_NOTIFICATION_SUBJECT = 'Deloitte: Your Postman workspace access';
export const DEFAULT_POSTMAN_WORKSPACE_URL = 'https://go.postman.co/';

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

function normalizeWorkspaceUrl(value: string | undefined): string {
  const candidate = value?.trim() || DEFAULT_POSTMAN_WORKSPACE_URL;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('postman-workspace-url must be a valid HTTPS URL.');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('postman-workspace-url must be a credential-free HTTPS URL.');
  }
  return url.toString();
}

function normalizeSubject(value: string | undefined): string {
  const subject = (value?.trim() || DEFAULT_NOTIFICATION_SUBJECT).replaceAll(/[\r\n]+/g, ' ').trim();
  if (subject.length > 200) throw new Error('notification-subject must be 200 characters or fewer.');
  return subject;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function notificationStatus(result: MemberResult): NotificationStatus {
  if (result.workspaceAccess === 'pending') return 'invitation-pending';
  if (result.workspaceAccess === 'would-add') return 'preview';
  if (result.workspaceAccess === 'failed' || result.lifecycle === 'failed') return 'needs-attention';
  return 'ready';
}

function statusCopy(result: MemberResult): { headline: string; nextStep: string } {
  if (result.workspaceAccess === 'pending') {
    return {
      headline: 'Your Postman team invitation has been submitted.',
      nextStep: 'Accept the Postman invitation in your inbox. The pipeline can add your workspace access on its next run.'
    };
  }
  if (result.workspaceAccess === 'would-add') {
    return {
      headline: 'Your Postman onboarding is included in the current preview.',
      nextStep: 'No email is sent from a preview. The pipeline will provision access when the approved apply run starts.'
    };
  }
  if (result.workspaceAccess === 'failed' || result.lifecycle === 'failed') {
    return {
      headline: 'Deloitte identified that you need Postman access, but this run could not finish it.',
      nextStep: 'The pipeline owner has the failure details and can safely retry your onboarding.'
    };
  }
  if (result.lifecycle === 'provisioned') {
    return {
      headline: 'Your Postman team membership and workspace access are ready.',
      nextStep: 'Sign in with your Deloitte email address, use Deloitte SSO if prompted, and open the workspace.'
    };
  }
  if (result.lifecycle === 'reactivated') {
    return {
      headline: 'Your Postman account was reactivated and your workspace access is ready.',
      nextStep: 'Sign in with your Deloitte email address and open the workspace.'
    };
  }
  return {
    headline: 'Your Postman workspace access is ready.',
    nextStep: 'Sign in with your Deloitte email address and open the workspace.'
  };
}

function repositoryCopy(sourceRepository: string | undefined): string {
  return sourceRepository
    ? `You were included in Postman onboarding because you were detected as a contributor to ${sourceRepository}.`
    : 'You were included in Postman onboarding because you were detected as a contributor to a Deloitte GitHub repository.';
}

function renderText(
  result: MemberResult,
  workspaceUrl: string,
  sourceRepository: string | undefined
): string {
  const copy = statusCopy(result);
  return [
    'Hello,',
    '',
    repositoryCopy(sourceRepository),
    copy.headline,
    '',
    `Postman workspace role: ${result.workspaceRole}`,
    `Next step: ${copy.nextStep}`,
    `Open Postman: ${workspaceUrl}`,
    '',
    'Three useful ways to get started:',
    '- Find and reuse the APIs, collections, and environments your repository depends on.',
    '- Run collections locally or in CI to validate API behavior before merging.',
    '- Collaborate in the workspace so API changes, examples, and tests stay discoverable.',
    '',
    '— Deloitte API Enablement'
  ].join('\n');
}

function renderHtml(
  result: MemberResult,
  workspaceUrl: string,
  sourceRepository: string | undefined
): string {
  const copy = statusCopy(result);
  const safeUrl = escapeHtml(workspaceUrl);
  return [
    '<!doctype html>',
    '<html><body style="margin:0;background:#f7f7f7;font-family:Arial,sans-serif;color:#212121">',
    '<div style="max-width:640px;margin:24px auto;background:#ffffff;border:1px solid #e6e6e6;border-radius:12px;overflow:hidden">',
    '<div style="height:8px;background:#ff6c37"></div>',
    '<div style="padding:32px">',
    '<p style="margin-top:0">Hello,</p>',
    `<p>${escapeHtml(repositoryCopy(sourceRepository))}</p>`,
    `<h2 style="color:#ff6c37">${escapeHtml(copy.headline)}</h2>`,
    `<p><strong>Postman workspace role:</strong> ${escapeHtml(result.workspaceRole)}</p>`,
    `<p><strong>Next step:</strong> ${escapeHtml(copy.nextStep)}</p>`,
    `<p style="margin:28px 0"><a href="${safeUrl}" style="background:#ff6c37;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:bold">Open Postman</a></p>`,
    '<h3>Get value from the workspace</h3>',
    '<ul>',
    '<li>Find and reuse the APIs, collections, and environments your repository depends on.</li>',
    '<li>Run collections locally or in CI before merging API changes.</li>',
    '<li>Keep API examples, tests, and collaboration discoverable for the whole team.</li>',
    '</ul>',
    '<p style="margin-bottom:0">— Deloitte API Enablement</p>',
    '</div></div></body></html>'
  ].join('');
}

function notificationFor(
  result: MemberResult,
  summary: ReconcileSummary,
  options: Required<Pick<NotificationOptions, 'workspaceUrl' | 'subject'>> & Pick<NotificationOptions, 'sourceRepository'>
): OnboardingNotification {
  return {
    to: result.email,
    subject: options.subject,
    text: renderText(result, options.workspaceUrl, options.sourceRepository),
    html: renderHtml(result, options.workspaceUrl, options.sourceRepository),
    workspaceRole: result.workspaceRole,
    lifecycle: result.lifecycle,
    workspaceAccess: result.workspaceAccess,
    status: notificationStatus(result),
    send: !summary.dryRun && result.workspaceAccess !== 'would-add'
  };
}

export function buildNotificationEnvelope(
  summary: ReconcileSummary,
  options: NotificationOptions = {}
): NotificationEnvelope {
  const workspaceUrl = normalizeWorkspaceUrl(options.workspaceUrl);
  const subject = normalizeSubject(options.subject);
  const sourceRepository = options.sourceRepository?.trim() || undefined;
  return {
    schemaVersion: 1,
    kind: 'deloitte-postman-onboarding',
    workspace: { id: summary.workspaceId, url: workspaceUrl },
    ...(sourceRepository ? { sourceRepository } : {}),
    notifications: summary.results.map((result) => notificationFor(result, summary, {
      workspaceUrl,
      subject,
      ...(sourceRepository ? { sourceRepository } : {})
    }))
  };
}

export async function writeNotificationEnvelope(path: string, envelope: NotificationEnvelope): Promise<string> {
  const outputPath = resolve(path);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(envelope, null, 2)}\n`, { mode: 0o600 });
  return outputPath;
}

function notificationEndpoint(value: string): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error('The notification webhook must be a valid HTTPS URL.');
  }
  const local = endpoint.hostname === '127.0.0.1' || endpoint.hostname === 'localhost' || endpoint.hostname === '::1';
  if (endpoint.protocol !== 'https:' && !(local && endpoint.protocol === 'http:')) {
    throw new Error('The notification webhook must use HTTPS (HTTP is allowed only for localhost tests).');
  }
  if (endpoint.username || endpoint.password) {
    throw new Error('The notification webhook URL must not contain credentials.');
  }
  return endpoint;
}

export function validateNotificationConfiguration(
  options: NotificationOptions,
  webhookUrl?: string
): void {
  normalizeWorkspaceUrl(options.workspaceUrl);
  normalizeSubject(options.subject);
  if (webhookUrl?.trim()) notificationEndpoint(webhookUrl);
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter && /^\d+$/.test(retryAfter)) return Math.min(Number(retryAfter) * 1000, 5000);
  return attempt * 250;
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

export async function deliverNotificationEnvelope(
  envelope: NotificationEnvelope,
  options: {
    webhookUrl: string;
    token?: string;
    idempotencyKey?: string;
    fetchImpl?: FetchLike;
  }
): Promise<number> {
  const notifications = envelope.notifications.filter((notification) => notification.send);
  if (notifications.length === 0) return 0;
  const endpoint = notificationEndpoint(options.webhookUrl);
  const token = options.token?.trim();
  const idempotencyKey = options.idempotencyKey?.trim();
  const fetchImpl = options.fetchImpl ?? fetch;
  const payload = { ...envelope, notifications };
  const maxAttempts = idempotencyKey ? 3 : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': 'deloitte-postman-workspace-access-action',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {})
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000)
    });
    if (response.ok) return notifications.length;
    if (attempt < maxAttempts && RETRYABLE_STATUSES.has(response.status)) {
      await delay(retryDelay(response, attempt));
      continue;
    }
    throw new Error(`Notification gateway returned HTTP ${response.status}.`);
  }
  throw new Error('Notification gateway delivery failed.');
}
