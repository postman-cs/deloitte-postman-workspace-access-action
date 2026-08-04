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

  it('maps every supported GitHub repository role', () => {
    const members = parseMembersJson(JSON.stringify({ collaborators: [
      { email: 'admin@example.com', role_name: 'admin' },
      { email: 'maintain@example.com', role_name: 'maintain' },
      { email: 'write@example.com', role_name: 'write' },
      { email: 'triage@example.com', role_name: 'triage' },
      { email: 'read@example.com', role_name: 'read' }
    ] }), { ...DEFAULT_ROLE_MAP });

    expect(members.map(({ email, workspaceRole }) => ({ email, workspaceRole }))).toEqual([
      { email: 'admin@example.com', workspaceRole: 'Admin' },
      { email: 'maintain@example.com', workspaceRole: 'Editor' },
      { email: 'write@example.com', workspaceRole: 'Editor' },
      { email: 'triage@example.com', workspaceRole: 'Viewer' },
      { email: 'read@example.com', workspaceRole: 'Viewer' }
    ]);
  });

  it('falls back from an unmapped custom role to its highest mapped base permission', () => {
    const members = parseMembersJson(JSON.stringify([{
      email: 'custom@example.com',
      role_name: 'api-contributor',
      permissions: { pull: true, triage: true, push: true, admin: false }
    }]), { ...DEFAULT_ROLE_MAP });

    expect(members[0]).toMatchObject({
      email: 'custom@example.com',
      githubPermission: 'push',
      workspaceRole: 'Editor'
    });
  });

  it('prefers an explicit custom-role mapping over base-permission fallback', () => {
    const members = parseMembersJson(JSON.stringify([{
      email: 'custom-admin@example.com',
      role_name: 'api-owner',
      permissions: { push: true, pull: true }
    }]), { ...DEFAULT_ROLE_MAP, 'api-owner': 'Admin' });

    expect(members[0]).toMatchObject({
      githubPermission: 'api-owner',
      workspaceRole: 'Admin'
    });
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
    expect(parseRoleMap('{"owner":"Admin","read":"Editor"}')).toEqual({
      ...DEFAULT_ROLE_MAP,
      owner: 'Admin',
      read: 'Editor'
    });
    expect(() => parseRoleMap('[]')).toThrow(/JSON object/);
  });
});
