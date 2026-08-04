import { describe, expect, it } from 'vitest';

import { buildValidationReport, formatMarkdownSummary } from '../src/runtime.js';

describe('operator reporting', () => {
  it('builds a credential-free scanner validation report', () => {
    const report = buildValidationReport([
      { email: 'admin@example.com', workspaceRole: 'Admin', githubPermission: 'admin' },
      { email: 'viewer@example.com', workspaceRole: 'Viewer', scimId: 'scim-viewer' }
    ], '/tmp/scanner-output.json');

    expect(report).toMatchObject({
      ok: true,
      scanner: { uniqueMembers: 2, withScimId: 1, requiringScimLookup: 1 },
      workspaceRoles: { Admin: 1, Viewer: 1 }
    });
  });

  it('renders a readable summary with per-user remediation and escaped cells', () => {
    const markdown = formatMarkdownSummary({
      workspaceId: 'workspace|one',
      dryRun: false,
      counts: { added: 1, invited: 1, pending: 1, skipped: 0, failed: 0 },
      results: [{
        email: 'pending@example.com',
        workspaceRole: 'Viewer',
        lifecycle: 'provisioned',
        workspaceAccess: 'pending'
      }]
    });

    expect(markdown).toContain('⚠️ Invitations pending');
    expect(markdown).toContain('workspace\\|one');
    expect(markdown).toContain('| User | Workspace role | Team lifecycle | Workspace access | Next step |');
    expect(markdown).toContain('Accept the Postman team invitation, then rerun.');
  });
});
