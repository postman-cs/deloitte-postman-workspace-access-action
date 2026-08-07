import * as core from '@actions/core';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  DEFAULT_CONFIG_FILE,
  loadDeloitteConfig,
  loadIdentityMap,
  pathFromConfig
} from './config.js';
import { parseBoolean } from './contracts.js';
import type { InvalidMemberPolicy } from './contracts.js';
import {
  buildNotificationEnvelope,
  deliverNotificationEnvelope,
  validateNotificationConfiguration,
  writeNotificationEnvelope
} from './notifications.js';
import { PostmanClient } from './postman-client.js';
import { reconcileWorkspaceAccess } from './reconcile.js';
import { formatMarkdownSummary, formatSummary, resolveMembersInput } from './runtime.js';

function optionalInput(name: string): string | undefined {
  const value = core.getInput(name).trim();
  return value || undefined;
}

function stringArrayInput(name: string): string[] | undefined {
  const value = optionalInput(name);
  if (!value) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`${name} must be a JSON array: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new Error(`${name} must be a JSON array of strings.`);
  }
  return parsed.map((item) => item.trim()).filter(Boolean);
}

function memberPolicy(value: string | undefined): InvalidMemberPolicy | undefined {
  if (!value) return undefined;
  if (value === 'continue' || value === 'fail') return value;
  throw new Error('invalid-member-policy must be continue or fail.');
}

function markdownInline(value: string): string {
  return value.replaceAll('`', '\\`').replaceAll(/\r?\n/gu, ' ');
}

export async function runAction(): Promise<void> {
  try {
    const workspaceId = core.getInput('workspace-id', { required: true }).trim();
    const postmanApiKey = core.getInput('postman-api-key', { required: true }).trim();
    const postmanAccessToken = optionalInput('postman-access-token');
    const scimApiKey = optionalInput('postman-scim-api-key');
    const notificationWebhookUrl = optionalInput('notification-webhook-url');
    const notificationWebhookToken = optionalInput('notification-webhook-token');
    const configInput = optionalInput('config-file') ?? DEFAULT_CONFIG_FILE;
    const loadedConfig = await loadDeloitteConfig(configInput);
    const config = loadedConfig.config;
    const workspaceUrl = optionalInput('postman-workspace-url') ?? config.postmanWorkspaceUrl;
    const notificationSubject = optionalInput('notification-subject') ?? config.notification?.subject;
    core.setSecret(postmanApiKey);
    if (postmanAccessToken) core.setSecret(postmanAccessToken);
    if (scimApiKey) core.setSecret(scimApiKey);
    if (notificationWebhookUrl) core.setSecret(notificationWebhookUrl);
    if (notificationWebhookToken) core.setSecret(notificationWebhookToken);
    validateNotificationConfiguration({
      ...(workspaceUrl ? { workspaceUrl } : {}),
      ...(notificationSubject ? { subject: notificationSubject } : {}),
      ...(config.notification?.gettingStartedUrl ? { gettingStartedUrl: config.notification.gettingStartedUrl } : {}),
      ...(config.notification?.helpUrl ? { helpUrl: config.notification.helpUrl } : {})
    }, notificationWebhookUrl);

    const identityMapPath = optionalInput('identity-map-file')
      ?? pathFromConfig(loadedConfig.path, config.scanner?.identityMapFile);
    const configuredScannerRoot = pathFromConfig(loadedConfig.path, config.scanner?.searchRoot);
    const identityMap = await loadIdentityMap(identityMapPath);
    const invalidMemberPolicy = memberPolicy(optionalInput('invalid-member-policy'))
      ?? config.scanner?.invalidMemberPolicy
      ?? 'continue';
    const excludeBotsInput = optionalInput('exclude-bots');
    const excludeBots = excludeBotsInput == null
      ? config.scanner?.excludeBots ?? false
      : parseBoolean(excludeBotsInput);
    const excludeLogins = stringArrayInput('exclude-logins-json') ?? config.scanner?.excludeLogins ?? [];

    const resolved = await resolveMembersInput(
      optionalInput('members-json'),
      optionalInput('members-file'),
      optionalInput('role-map-json') ?? (config.roleMap ? JSON.stringify(config.roleMap) : undefined),
      optionalInput('scanner-search-root') ?? configuredScannerRoot,
      optionalInput('default-workspace-role') ?? config.defaultWorkspaceRole ?? 'Viewer',
      {
        identityMap,
        excludeBots,
        excludeLogins,
        invalidMemberPolicy
      }
    );
    if (resolved.discovered) core.info(`Auto-discovered scanner output at ${resolved.source}.`);
    for (const issue of resolved.unresolved.slice(0, 20)) {
      core.warning(`Unresolved scanner member ${issue.identifier}: ${issue.reason}`);
    }
    if (resolved.unresolved.length > 20) {
      core.warning(`${resolved.unresolved.length - 20} additional unresolved scanner member(s) are in unresolved-json.`);
    }
    const dryRun = parseBoolean(optionalInput('dry-run'));
    const failOnPending = parseBoolean(optionalInput('fail-on-pending-invites'));
    const baseUrl = optionalInput('postman-base-url');
    const client = new PostmanClient({
      postmanApiKey,
      ...(postmanAccessToken ? { postmanAccessToken } : {}),
      ...(scimApiKey ? { scimApiKey } : {}),
      ...(baseUrl ? { baseUrl } : {})
    });

    const summary = await reconcileWorkspaceAccess(client, {
      workspaceId,
      members: resolved.members,
      dryRun
    }, {
      info: (message) => core.info(message),
      warning: (message) => core.warning(message)
    });

    core.setOutput('summary-json', JSON.stringify(summary));
    core.setOutput('added-count', String(summary.counts.added));
    core.setOutput('invited-count', String(summary.counts.invited));
    core.setOutput('pending-count', String(summary.counts.pending));
    core.setOutput('skipped-count', String(summary.counts.skipped));
    core.setOutput('failed-count', String(summary.counts.failed));
    core.setOutput('detected-count', String(resolved.detected));
    core.setOutput('resolved-count', String(resolved.members.length));
    core.setOutput('unresolved-count', String(resolved.unresolved.length));
    core.setOutput('excluded-count', String(resolved.excluded.length));
    core.setOutput('unresolved-json', JSON.stringify(resolved.unresolved));
    core.setOutput('scanner-source', resolved.source);
    core.setOutput('config-source', loadedConfig.path ?? 'built-in defaults');
    const summaryFile = optionalInput('summary-file');
    if (summaryFile) {
      const summaryPath = resolve(summaryFile);
      await mkdir(dirname(summaryPath), { recursive: true });
      await writeFile(summaryPath, `${formatSummary({
        ...summary,
        scanner: {
          source: resolved.source,
          detected: resolved.detected,
          resolved: resolved.members.length,
          unresolved: resolved.unresolved,
          excluded: resolved.excluded
        },
        configSource: loadedConfig.path ?? 'built-in defaults'
      })}\n`, { mode: 0o600 });
      core.setOutput('summary-file', summaryPath);
    }
    const scannerMarkdown = [
      '',
      '### Scanner resolution',
      '',
      '| Detected | Resolved | Unresolved | Excluded |',
      '| ---: | ---: | ---: | ---: |',
      `| ${resolved.detected} | ${resolved.members.length} | ${resolved.unresolved.length} | ${resolved.excluded.length} |`,
      ...(resolved.unresolved.length > 0
        ? [
            '',
            'Unresolved identities:',
            '',
            ...resolved.unresolved.slice(0, 20).map((issue) => (
              `- \`${markdownInline(issue.identifier)}\`: ${markdownInline(issue.reason)}`
            ))
          ]
        : []),
      ''
    ].join('\n');
    await core.summary.addRaw(`${formatMarkdownSummary(summary)}${scannerMarkdown}`).write();

    const sourceRepository = optionalInput('source-repository')
      ?? config.sourceRepository
      ?? process.env.GITHUB_REPOSITORY;
    const notificationEnvelope = buildNotificationEnvelope(summary, {
      ...(workspaceUrl ? { workspaceUrl } : {}),
      ...(sourceRepository ? { sourceRepository } : {}),
      ...(notificationSubject ? { subject: notificationSubject } : {}),
      ...(config.notification?.gettingStartedUrl ? { gettingStartedUrl: config.notification.gettingStartedUrl } : {}),
      ...(config.notification?.helpUrl ? { helpUrl: config.notification.helpUrl } : {}),
      ...(config.notification?.allowedDomains ? { allowedDomains: config.notification.allowedDomains } : {})
    });
    const notificationCount = notificationEnvelope.notifications.length;
    const eligibleNotificationCount = notificationEnvelope.notifications.filter(({ send }) => send).length;
    core.setOutput('notification-count', String(notificationCount));
    core.setOutput('notification-eligible-count', String(eligibleNotificationCount));
    core.setOutput('notification-delivered-count', '0');
    let deliveredNotificationCount = 0;
    const notificationsFile = optionalInput('notifications-file');
    if (notificationsFile) {
      const notificationsPath = await writeNotificationEnvelope(notificationsFile, notificationEnvelope);
      core.setOutput('notifications-file', notificationsPath);
    }
    if (notificationWebhookUrl) {
      const runId = process.env.GITHUB_RUN_ID?.trim();
      const runAttempt = process.env.GITHUB_RUN_ATTEMPT?.trim() || '1';
      const delivered = await deliverNotificationEnvelope(notificationEnvelope, {
        webhookUrl: notificationWebhookUrl,
        ...(notificationWebhookToken ? { token: notificationWebhookToken } : {}),
        ...(runId ? { idempotencyKey: `deloitte-postman:${workspaceId}:${runId}:${runAttempt}` } : {})
      });
      deliveredNotificationCount = delivered;
      core.setOutput('notification-delivered-count', String(delivered));
      core.info(`Deloitte notification gateway accepted ${delivered} onboarding notification(s).`);
    } else if (!dryRun && notificationCount > 0) {
      core.info('Onboarding notifications were generated but not delivered because notification-webhook-url is not configured.');
    }
    core.setOutput('metrics-json', JSON.stringify({
      scanner: {
        detected: resolved.detected,
        resolved: resolved.members.length,
        unresolved: resolved.unresolved.length,
        excluded: resolved.excluded.length
      },
      access: summary.counts,
      notifications: {
        rendered: notificationCount,
        eligible: eligibleNotificationCount,
        delivered: deliveredNotificationCount
      }
    }));

    if (summary.counts.failed > 0) {
      throw new Error(`${summary.counts.failed} workspace access operation(s) failed.`);
    }
    if (failOnPending && summary.counts.pending > 0) {
      throw new Error(`${summary.counts.pending} invited user(s) are pending before workspace access can be assigned.`);
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

if (process.env.NODE_ENV !== 'test') {
  void runAction();
}
