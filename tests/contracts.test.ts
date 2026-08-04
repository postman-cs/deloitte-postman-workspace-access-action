import { describe, expect, it } from 'vitest';

import { DEFAULT_ROLE_MAP, parseMembersJson, parseRoleMap } from '../src/contracts.js';

describe('scanner contract', () => {
  it('accepts GitHub collaborator permission objects', () => {
    const members = parseMembersJson(JSON.stringify({ collaborators: [{
      login: 'octocat',
      email: 'Octo@example.com',
      permissions: { admin: false, maintain: false, push: true, triage: true, pull: true }
    }] }), { ...DEFAULT_ROLE_MAP });

    expect(members).toEqual([expect.objectContaining({
      email: 'octo@example.com',
      githubLogin: 'octocat',
      githubPermission: 'push',
      workspaceRole: 'Editor',
      externalId: 'octocat'
    })]);
  });

  it('supports snake_case scanner fields and explicit workspace roles', () => {
    const members = parseMembersJson(JSON.stringify([{
      email: 'viewer@example.com',
      scim_id: 'scim-1',
      workspace_role: 'Viewer'
    }]), { ...DEFAULT_ROLE_MAP });

    expect(members[0]).toMatchObject({
      email: 'viewer@example.com',
      scimId: 'scim-1',
      workspaceRole: 'Viewer'
    });
  });

  it('deduplicates email addresses and keeps the strongest role', () => {
    const members = parseMembersJson(JSON.stringify([
      { email: 'dev@example.com', permission: 'read' },
      { email: 'DEV@example.com', permission: 'admin' }
    ]), { ...DEFAULT_ROLE_MAP });

    expect(members).toHaveLength(1);
    expect(members[0]?.workspaceRole).toBe('Admin');
  });

  it('rejects unmapped scanner permissions', () => {
    expect(() => parseMembersJson(JSON.stringify([
      { email: 'dev@example.com', permission: 'unknown' }
    ]), { ...DEFAULT_ROLE_MAP })).toThrow(/not present in role-map-json/);
  });

  it('validates role map JSON', () => {
    expect(parseRoleMap('{"owner":"Admin"}')).toEqual({ owner: 'Admin' });
    expect(() => parseRoleMap('[]')).toThrow(/JSON object/);
  });
});
