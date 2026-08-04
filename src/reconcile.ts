import { HttpError, PostmanClient } from './postman-client.js';
import type {
  MemberResult,
  ReconcileOptions,
  ReconcileSummary,
  Reporter,
  RoleAssignment
} from './types.js';

const PENDING_INVITE_STATUSES = new Set([400, 404, 409, 422]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function summarize(workspaceId: string, dryRun: boolean, results: MemberResult[]): ReconcileSummary {
  return {
    workspaceId,
    dryRun,
    results,
    counts: {
      added: results.filter((result) => result.workspaceAccess === 'added').length,
      invited: results.filter((result) => result.lifecycle === 'provisioned').length,
      pending: results.filter((result) => result.workspaceAccess === 'pending').length,
      skipped: results.filter((result) => result.workspaceAccess === 'would-add').length,
      failed: results.filter((result) => result.lifecycle === 'failed' || result.workspaceAccess === 'failed').length
    }
  };
}

function resultFor(
  assignment: RoleAssignment,
  workspaceAccess: MemberResult['workspaceAccess'],
  message?: string
): MemberResult {
  return {
    email: assignment.member.email,
    workspaceRole: assignment.member.workspaceRole,
    lifecycle: assignment.lifecycle,
    workspaceAccess,
    scimId: assignment.scimId,
    ...(message ? { message } : {})
  };
}

export async function reconcileWorkspaceAccess(
  client: PostmanClient,
  options: ReconcileOptions,
  reporter: Reporter
): Promise<ReconcileSummary> {
  const roles = await client.getWorkspaceRoles();
  const roleIds = new Map(roles.map((role) => [role.displayName.toLowerCase(), role.id]));
  const results: MemberResult[] = [];
  const assignments: RoleAssignment[] = [];

  for (const member of options.members) {
    const roleId = roleIds.get(member.workspaceRole.toLowerCase());
    if (!roleId) {
      results.push({
        email: member.email,
        workspaceRole: member.workspaceRole,
        lifecycle: 'failed',
        workspaceAccess: 'failed',
        message: `Postman workspace role ${member.workspaceRole} is not available.`
      });
      continue;
    }

    let scimId = member.scimId;
    let lifecycle: RoleAssignment['lifecycle'] = member.scimId ? 'provided-scim-id' : 'existing';
    try {
      if (!scimId) {
        const existing = await client.findScimUserByEmail(member.email);
        if (existing?.active === false) {
          if (options.dryRun) {
            results.push({
              email: member.email,
              workspaceRole: member.workspaceRole,
              lifecycle: 'would-reactivate',
              workspaceAccess: 'would-add',
              scimId: existing.id,
              message: 'Would reactivate the existing SCIM user, then assign the workspace role.'
            });
            continue;
          }
          const reactivated = await client.reactivateScimUser(existing);
          scimId = reactivated.id;
          lifecycle = 'reactivated';
          reporter.info(`Reactivated ${member.email} through Postman SCIM.`);
        } else {
          scimId = existing?.id;
        }
      }
      if (!scimId && options.dryRun) {
        results.push({
          email: member.email,
          workspaceRole: member.workspaceRole,
          lifecycle: 'would-provision',
          workspaceAccess: 'would-add',
          message: 'Would provision or invite the user, then assign the workspace role.'
        });
        continue;
      }
      if (!scimId) {
        const provision = await client.provisionScimUser(member);
        scimId = provision.user.id;
        lifecycle = provision.created ? 'provisioned' : 'existing';
        if (provision.created) {
          reporter.info(`Submitted ${member.email} to Postman SCIM for provisioning or invitation.`);
        }
      }
      if (!scimId) throw new Error(`Unable to resolve a SCIM ID for ${member.email}.`);
      assignments.push({ member, scimId, roleId, lifecycle });
    } catch (error) {
      results.push({
        email: member.email,
        workspaceRole: member.workspaceRole,
        lifecycle: 'failed',
        workspaceAccess: 'failed',
        message: errorMessage(error)
      });
    }
  }

  if (options.dryRun) {
    results.push(...assignments.map((assignment) => resultFor(
      assignment,
      'would-add',
      'Would assign the resolved user to the workspace.'
    )));
    return summarize(options.workspaceId, true, results);
  }

  for (let offset = 0; offset < assignments.length; offset += 50) {
    const batch = assignments.slice(offset, offset + 50);
    try {
      await client.assignWorkspaceRoles(
        options.workspaceId,
        batch.map(({ scimId, roleId }) => ({ scimId, roleId }))
      );
      results.push(...batch.map((assignment) => resultFor(assignment, 'added')));
      continue;
    } catch (batchError) {
      reporter.warning(`A workspace-role batch failed; retrying ${batch.length} user(s) individually.`);
    }

    for (const assignment of batch) {
      try {
        await client.assignWorkspaceRoles(options.workspaceId, [{
          scimId: assignment.scimId,
          roleId: assignment.roleId
        }]);
        results.push(resultFor(assignment, 'added'));
      } catch (error) {
        const pending = assignment.lifecycle === 'provisioned'
          && error instanceof HttpError
          && PENDING_INVITE_STATUSES.has(error.status);
        results.push(resultFor(
          assignment,
          pending ? 'pending' : 'failed',
          pending
            ? 'The team invite was submitted; assign the workspace role after the user accepts the invite.'
            : errorMessage(error)
        ));
      }
    }
  }

  return summarize(options.workspaceId, false, results);
}
