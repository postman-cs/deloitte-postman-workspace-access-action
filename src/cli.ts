import { parseArgs } from 'node:util';

import { DEFAULT_ROLE_MAP, parseBoolean } from './contracts.js';
import { diagnoseWorkspaceAccess } from './doctor.js';
import { PostmanClient } from './postman-client.js';
import { reconcileWorkspaceAccess } from './reconcile.js';
import { buildValidationReport, formatSummary, resolveMembersInput } from './runtime.js';

const HELP = `postman-workspace-access

Reconcile scanner-produced collaborators into a Postman workspace.

Usage:
  postman-workspace-access --workspace-id <id> --members-file <path> [options]
  postman-workspace-access doctor --workspace-id <id> [options]
  postman-workspace-access validate [--members-file <path> | --scanner-search-root <path>]

Options:
  --workspace-id <id>               Target Postman workspace ID.
  --members-file <path>             Scanner output JSON file.
  --members-json <json>             Inline scanner output JSON.
  --scanner-search-root <path>      Root used to auto-discover scanner output; defaults to current directory.
  --role-map-json <json>            GitHub permission to Postman role map.
  --postman-base-url <url>          Defaults to https://api.postman.com.
  --dry-run                         Plan without writes.
  --fail-on-pending-invites         Exit non-zero while invitations are pending.
  --help                            Show this help.

Environment:
  POSTMAN_API_KEY                    Required for doctor and reconciliation; not required for validate.
  POSTMAN_SCIM_API_KEY               Required for doctor and for users needing SCIM lookup/provisioning.
`;

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  const command = argv[0] === 'doctor' || argv[0] === 'validate' ? argv[0] : 'reconcile';
  const commandArgs = command === 'reconcile' ? argv : argv.slice(1);
  const { values } = parseArgs({
    args: commandArgs,
    allowPositionals: false,
    strict: true,
    options: {
      'workspace-id': { type: 'string' },
      'members-file': { type: 'string' },
      'members-json': { type: 'string' },
      'scanner-search-root': { type: 'string', default: process.cwd() },
      'role-map-json': { type: 'string', default: JSON.stringify(DEFAULT_ROLE_MAP) },
      'postman-base-url': { type: 'string', default: 'https://api.postman.com' },
      'dry-run': { type: 'boolean', default: false },
      'fail-on-pending-invites': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false }
    }
  });
  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const resolved = await resolveMembersInput(
    values['members-json'],
    values['members-file'],
    values['role-map-json'],
    values['scanner-search-root']
  );
  if (resolved.discovered) process.stderr.write(`info: Auto-discovered scanner output at ${resolved.source}.\n`);
  if (command === 'validate') {
    process.stdout.write(`${formatSummary(buildValidationReport(resolved.members, resolved.source))}\n`);
    return 0;
  }

  const workspaceId = values['workspace-id']?.trim();
  if (!workspaceId) throw new Error('--workspace-id is required.');
  const postmanApiKey = process.env.POSTMAN_API_KEY?.trim();
  if (!postmanApiKey) throw new Error('POSTMAN_API_KEY is required.');
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
    process.stdout.write(`${formatSummary(report)}\n`);
    return report.ok ? 0 : 1;
  }
  const summary = await reconcileWorkspaceAccess(client, {
    workspaceId,
    members: resolved.members,
    dryRun: parseBoolean(String(values['dry-run']))
  }, {
    info: (message) => process.stderr.write(`info: ${message}\n`),
    warning: (message) => process.stderr.write(`warning: ${message}\n`)
  });
  process.stdout.write(`${formatSummary(summary)}\n`);
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
