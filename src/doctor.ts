import { PostmanClient } from './postman-client.js';
import { reconcileWorkspaceAccess } from './reconcile.js';
import type { DoctorReport, NormalizedMember, Reporter } from './types.js';

export interface DoctorOptions {
  workspaceId: string;
  members: NormalizedMember[];
  scannerSource: string;
}

export async function diagnoseWorkspaceAccess(
  client: PostmanClient,
  options: DoctorOptions,
  reporter: Reporter
): Promise<DoctorReport> {
  const workspace = await client.getWorkspace(options.workspaceId);
  await client.checkScimAccess();
  const plan = await reconcileWorkspaceAccess(client, {
    workspaceId: options.workspaceId,
    members: options.members,
    dryRun: true
  }, reporter);
  const roleMappingOk = plan.counts.failed === 0;

  return {
    ok: roleMappingOk,
    workspace,
    scanner: {
      source: options.scannerSource,
      members: options.members.length
    },
    checks: [
      {
        name: 'workspace-access',
        status: 'passed',
        message: `POSTMAN_API_KEY can read workspace ${workspace.name ?? workspace.id}.`
      },
      {
        name: 'scim-access',
        status: 'passed',
        message: 'POSTMAN_SCIM_API_KEY can read the team directory.'
      },
      {
        name: 'scanner-contract',
        status: 'passed',
        message: `Validated and normalized ${options.members.length} unique member(s).`
      },
      {
        name: 'role-mapping',
        status: roleMappingOk ? 'passed' : 'failed',
        message: roleMappingOk
          ? 'Every requested Postman workspace role is available.'
          : `${plan.counts.failed} member(s) request unavailable workspace roles.`
      },
      {
        name: 'read-only-plan',
        status: 'passed',
        message: 'Doctor mode issued read-only requests; no users or workspace roles were changed.'
      }
    ],
    plan
  };
}
