import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

import {
  DEFAULT_CONFIG_FILE,
  loadDeloitteConfig,
  loadIdentityMap,
  pathFromConfig
} from './config.js';
import { parseBoolean } from './contracts.js';
import type { InvalidMemberPolicy } from './contracts.js';
import { diagnoseWorkspaceAccess } from './doctor.js';
import {
  buildNotificationEnvelope,
  deliverNotificationEnvelope,
  validateNotificationConfiguration,
  writeNotificationEnvelope
} from './notifications.js';
import { PostmanClient } from './postman-client.js';
import { reconcileWorkspaceAccess } from './reconcile.js';
import { buildValidationReport, formatSummary, resolveMembersInput } from './runtime.js';
import { installStarterKit } from './setup.js';
import type { ReconcileSummary } from './types.js';

const HELP = `postman-workspace-access

Zero-touch onboarding from Deloitte's GitHub scanner into Postman.

Usage:
  postman-workspace-access init [--target <repo>]
  postman-workspace-access upgrade [--target <repo>]
  postman-workspace-access config validate [--config-file <path>]
  postman-workspace-access notify-test --email <address> --workspace-id <id> --confirm SEND_TEST_NOTIFICATION
  postman-workspace-access --workspace-id <id> [scanner options]
  postman-workspace-access doctor --workspace-id <id> [scanner options]
  postman-workspace-access validate [scanner options]

Scanner options:
  --config-file <path>              Defaults to .deloitte-postman.yml when present.
  --members-file <path>             Scanner output JSON file.
  --members-json <json>             Inline scanner output JSON.
  --scanner-search-root <path>      Root used to auto-discover scanner output.
  --identity-map-file <path>        JSON or login,email CSV identity map.
  --invalid-member-policy <policy>  continue (default) or fail.
  --exclude-bots                    Exclude scanner records typed or named as bots.
  --exclude-logins-json <json>      Logins intentionally excluded from onboarding.
  --role-map-json <json>            GitHub-to-Postman role extensions.
  --default-workspace-role <role>   Defaults to Viewer.

Reconciliation options:
  --postman-base-url <url>          Defaults to https://api.postman.com.
  --postman-workspace-url <url>     Link included in onboarding notifications.
  --notification-subject <text>     Email subject used by the notification gateway.
  --notifications-file <path>       Write rendered notification payloads as JSON.
  --dry-run                         Plan without writes or email delivery.
  --fail-on-pending-invites         Exit 2 while invitations are pending.

Environment:
  POSTMAN_API_KEY
  POSTMAN_SCIM_API_KEY
  DELOITTE_NOTIFICATION_WEBHOOK_URL
  DELOITTE_NOTIFICATION_WEBHOOK_TOKEN
`;

function invalidMemberPolicy(value: string | undefined): InvalidMemberPolicy | undefined {
  if (!value) return undefined;
  if (value === 'continue' || value === 'fail') return value;
  throw new Error('--invalid-member-policy must be continue or fail.');
}

function stringArrayJson(value: string | undefined, field: string): string[] | undefined {
  if (!value) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`${field} must be JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new Error(`${field} must be a JSON array of strings.`);
  }
  return parsed.map((item) => item.trim()).filter(Boolean);
}

async function runSetup(command: 'init' | 'upgrade', args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      target: { type: 'string', default: process.cwd() },
      help: { type: 'boolean', short: 'h', default: false }
    }
  });
  if (values.help) {
    process.stdout.write(`Usage: postman-workspace-access ${command} [--target <repo>]\n`);
    return 0;
  }
  const result = await installStarterKit(values.target, command === 'upgrade');
  process.stdout.write(`${formatSummary(result)}\n`);
  return 0;
}

async function runConfig(args: string[]): Promise<number> {
  if (args[0] !== 'validate') throw new Error('Usage: postman-workspace-access config validate [--config-file <path>]');
  const { values } = parseArgs({
    args: args.slice(1),
    strict: true,
    options: {
      'config-file': { type: 'string', default: DEFAULT_CONFIG_FILE }
    }
  });
  const loaded = await loadDeloitteConfig(values['config-file'], { required: true });
  const identityMapPath = pathFromConfig(loaded.path, loaded.config.scanner?.identityMapFile);
  const identityMap = await loadIdentityMap(identityMapPath);
  process.stdout.write(`${formatSummary({
    ok: true,
    configFile: loaded.path,
    identityMapFile: identityMapPath ?? null,
    identityMapEntries: Object.keys(identityMap).length,
    config: loaded.config
  })}\n`);
  return 0;
}

async function runNotificationTest(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      email: { type: 'string' },
      'workspace-id': { type: 'string' },
      'config-file': { type: 'string' },
      'postman-workspace-url': { type: 'string' },
      subject: { type: 'string' },
      'allowed-domain': { type: 'string', multiple: true },
      confirm: { type: 'string' }
    }
  });
  if (values.confirm !== 'SEND_TEST_NOTIFICATION') {
    throw new Error('--confirm SEND_TEST_NOTIFICATION is required.');
  }
  const email = values.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw new Error('--email must be valid.');
  const workspaceId = values['workspace-id']?.trim();
  if (!workspaceId) throw new Error('--workspace-id is required.');
  const webhookUrl = process.env.DELOITTE_NOTIFICATION_WEBHOOK_URL?.trim();
  if (!webhookUrl) throw new Error('DELOITTE_NOTIFICATION_WEBHOOK_URL is required.');
  const loadedConfig = await loadDeloitteConfig(values['config-file'] ?? DEFAULT_CONFIG_FILE);
  const notificationConfig = loadedConfig.config.notification;
  const testWorkspaceUrl = values['postman-workspace-url'] ?? loadedConfig.config.postmanWorkspaceUrl;
  const testSubject = values.subject ?? notificationConfig?.subject;
  const testAllowedDomains = values['allowed-domain'] ?? notificationConfig?.allowedDomains;
  const summary: ReconcileSummary = {
    workspaceId,
    dryRun: false,
    results: [{
      email,
      workspaceRole: 'Viewer',
      lifecycle: 'existing',
      workspaceAccess: 'added'
    }],
    counts: { added: 1, invited: 0, pending: 0, skipped: 0, failed: 0 }
  };
  const envelope = buildNotificationEnvelope(summary, {
    ...(testWorkspaceUrl ? { workspaceUrl: testWorkspaceUrl } : {}),
    ...(testSubject ? { subject: testSubject } : {}),
    ...(testAllowedDomains ? { allowedDomains: testAllowedDomains } : {}),
    ...(notificationConfig?.gettingStartedUrl ? { gettingStartedUrl: notificationConfig.gettingStartedUrl } : {}),
    ...(notificationConfig?.helpUrl ? { helpUrl: notificationConfig.helpUrl } : {})
  });
  const delivered = await deliverNotificationEnvelope(envelope, {
    webhookUrl,
    ...(process.env.DELOITTE_NOTIFICATION_WEBHOOK_TOKEN?.trim()
      ? { token: process.env.DELOITTE_NOTIFICATION_WEBHOOK_TOKEN.trim() }
      : {}),
    idempotencyKey: `deloitte-postman:test:${workspaceId}:${randomUUID()}`
  });
  process.stdout.write(`${formatSummary({ ok: true, recipient: email, accepted: delivered })}\n`);
  return 0;
}

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  if (argv[0] === 'init' || argv[0] === 'upgrade') return runSetup(argv[0], argv.slice(1));
  if (argv[0] === 'config') return runConfig(argv.slice(1));
  if (argv[0] === 'notify-test') return runNotificationTest(argv.slice(1));
  const command = argv[0] === 'doctor' || argv[0] === 'validate' ? argv[0] : 'reconcile';
  const commandArgs = command === 'reconcile' ? argv : argv.slice(1);
  const { values } = parseArgs({
    args: commandArgs,
    allowPositionals: false,
    strict: true,
    options: {
      'workspace-id': { type: 'string' },
      'config-file': { type: 'string' },
      'members-file': { type: 'string' },
      'members-json': { type: 'string' },
      'scanner-search-root': { type: 'string' },
      'identity-map-file': { type: 'string' },
      'invalid-member-policy': { type: 'string' },
      'exclude-bots': { type: 'boolean' },
      'exclude-logins-json': { type: 'string' },
      'role-map-json': { type: 'string' },
      'default-workspace-role': { type: 'string' },
      'postman-base-url': { type: 'string', default: 'https://api.postman.com' },
      'postman-workspace-url': { type: 'string' },
      'notification-subject': { type: 'string' },
      'notifications-file': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'fail-on-pending-invites': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false }
    }
  });
  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const loadedConfig = await loadDeloitteConfig(values['config-file'] ?? DEFAULT_CONFIG_FILE);
  const config = loadedConfig.config;
  const identityMapPath = values['identity-map-file']
    ?? pathFromConfig(loadedConfig.path, config.scanner?.identityMapFile);
  const configuredScannerRoot = pathFromConfig(loadedConfig.path, config.scanner?.searchRoot);
  const identityMap = await loadIdentityMap(identityMapPath);
  const policy = invalidMemberPolicy(values['invalid-member-policy'])
    ?? config.scanner?.invalidMemberPolicy
    ?? 'continue';
  const resolved = await resolveMembersInput(
    values['members-json'],
    values['members-file'],
    values['role-map-json'] ?? (config.roleMap ? JSON.stringify(config.roleMap) : undefined),
    values['scanner-search-root'] ?? configuredScannerRoot ?? process.cwd(),
    values['default-workspace-role'] ?? config.defaultWorkspaceRole ?? 'Viewer',
    {
      identityMap,
      excludeBots: values['exclude-bots'] ?? config.scanner?.excludeBots ?? false,
      excludeLogins: stringArrayJson(values['exclude-logins-json'], '--exclude-logins-json')
        ?? config.scanner?.excludeLogins
        ?? [],
      invalidMemberPolicy: policy
    }
  );
  if (resolved.discovered) process.stderr.write(`info: Auto-discovered scanner output at ${resolved.source}.\n`);
  for (const issue of resolved.unresolved) {
    process.stderr.write(`warning: Unresolved scanner member ${issue.identifier}: ${issue.reason}\n`);
  }
  if (command === 'validate') {
    process.stdout.write(`${formatSummary(buildValidationReport(resolved.members, resolved.source, resolved))}\n`);
    return policy === 'fail' && resolved.unresolved.length > 0 ? 1 : 0;
  }

  const workspaceId = values['workspace-id']?.trim();
  if (!workspaceId) throw new Error('--workspace-id is required.');
  const postmanApiKey = process.env.POSTMAN_API_KEY?.trim();
  if (!postmanApiKey) throw new Error('POSTMAN_API_KEY is required.');
  const workspaceUrl = values['postman-workspace-url'] ?? config.postmanWorkspaceUrl;
  const notificationSubject = values['notification-subject'] ?? config.notification?.subject;
  const notificationWebhookUrl = process.env.DELOITTE_NOTIFICATION_WEBHOOK_URL?.trim();
  const client = new PostmanClient({
    postmanApiKey,
    ...(process.env.POSTMAN_SCIM_API_KEY?.trim()
      ? { scimApiKey: process.env.POSTMAN_SCIM_API_KEY.trim() }
      : {}),
    ...(values['postman-base-url'] ? { baseUrl: values['postman-base-url'] } : {})
  });
  if (command === 'doctor') {
    const report = await diagnoseWorkspaceAccess(client, {
      workspaceId,
      members: resolved.members,
      scannerSource: resolved.source
    }, {
      info: (message) => process.stderr.write(`info: ${message}\n`),
      warning: (message) => process.stderr.write(`warning: ${message}\n`)
    });
    process.stdout.write(`${formatSummary({ ...report, scannerResolution: {
      detected: resolved.detected,
      resolved: resolved.members.length,
      unresolved: resolved.unresolved,
      excluded: resolved.excluded
    } })}\n`);
    return report.ok ? 0 : 1;
  }
  validateNotificationConfiguration({
    ...(workspaceUrl ? { workspaceUrl } : {}),
    ...(notificationSubject ? { subject: notificationSubject } : {}),
    ...(config.notification?.gettingStartedUrl ? { gettingStartedUrl: config.notification.gettingStartedUrl } : {}),
    ...(config.notification?.helpUrl ? { helpUrl: config.notification.helpUrl } : {})
  }, notificationWebhookUrl);
  const dryRun = parseBoolean(String(values['dry-run']));
  const summary = await reconcileWorkspaceAccess(client, {
    workspaceId,
    members: resolved.members,
    dryRun
  }, {
    info: (message) => process.stderr.write(`info: ${message}\n`),
    warning: (message) => process.stderr.write(`warning: ${message}\n`)
  });
  const sourceRepository = config.sourceRepository ?? process.env.GITHUB_REPOSITORY ?? process.env.CI_PROJECT_PATH;
  const notificationEnvelope = buildNotificationEnvelope(summary, {
    ...(workspaceUrl ? { workspaceUrl } : {}),
    ...(sourceRepository ? { sourceRepository } : {}),
    ...(notificationSubject ? { subject: notificationSubject } : {}),
    ...(config.notification?.gettingStartedUrl ? { gettingStartedUrl: config.notification.gettingStartedUrl } : {}),
    ...(config.notification?.helpUrl ? { helpUrl: config.notification.helpUrl } : {}),
    ...(config.notification?.allowedDomains ? { allowedDomains: config.notification.allowedDomains } : {})
  });
  if (values['notifications-file']) {
    const notificationPath = await writeNotificationEnvelope(values['notifications-file'], notificationEnvelope);
    process.stderr.write(`info: Wrote ${notificationEnvelope.notifications.length} onboarding notification(s) to ${notificationPath}.\n`);
  }
  let delivered = 0;
  if (notificationWebhookUrl) {
    const runId = process.env.GITHUB_RUN_ID?.trim() ?? process.env.CI_PIPELINE_ID?.trim();
    delivered = await deliverNotificationEnvelope(notificationEnvelope, {
      webhookUrl: notificationWebhookUrl,
      ...(process.env.DELOITTE_NOTIFICATION_WEBHOOK_TOKEN?.trim()
        ? { token: process.env.DELOITTE_NOTIFICATION_WEBHOOK_TOKEN.trim() }
        : {}),
      ...(runId ? { idempotencyKey: `deloitte-postman:${workspaceId}:${runId}` } : {})
    });
    process.stderr.write(`info: Deloitte notification gateway accepted ${delivered} onboarding notification(s).\n`);
  }
  process.stdout.write(`${formatSummary({
    ...summary,
    scanner: {
      detected: resolved.detected,
      resolved: resolved.members.length,
      unresolved: resolved.unresolved,
      excluded: resolved.excluded
    },
    notifications: {
      rendered: notificationEnvelope.notifications.length,
      delivered
    }
  })}\n`);
  if (summary.counts.failed > 0) return 1;
  if (values['fail-on-pending-invites'] && summary.counts.pending > 0) return 2;
  return 0;
}

runCli()
  .then((code) => { process.exitCode = code; })
  .catch((error) => {
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
