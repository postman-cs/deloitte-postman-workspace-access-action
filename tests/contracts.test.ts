import { describe, expect, it } from 'vitest';

import { DEFAULT_ROLE_MAP, parseMembersJson, parseMembersReport, parseRoleMap } from '../src/contracts.js';

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
    ]), { ...DEFAULT_ROLE_MAP })).toThrow(/No explicit, mapped, or default Postman workspace role/);
  });

  it('continues valid onboarding while reporting missing identities', () => {
    const report = parseMembersReport(JSON.stringify([
      { login: 'valid-user', email: 'valid@example.com', permission: 'write' },
      { login: 'mapped-user', permission: 'read' },
      { login: 'missing-email', permission: 'read' },
      { login: 'dependabot[bot]', type: 'Bot', permission: 'write' },
      { login: 'service-account', email: 'service@example.com', permission: 'admin' }
    ]), { ...DEFAULT_ROLE_MAP }, {
      defaultWorkspaceRole: 'Viewer',
      identityMap: { 'mapped-user': 'mapped@example.com' },
      excludeBots: true,
      excludeLogins: ['service-account'],
      invalidMemberPolicy: 'continue'
    });

    expect(report.detected).toBe(5);
    expect(report.members.map(({ email }) => email)).toEqual(['valid@example.com', 'mapped@example.com']);
    expect(report.unresolved).toEqual([expect.objectContaining({ githubLogin: 'missing-email' })]);
    expect(report.excluded).toHaveLength(2);
  });

  it('blocks a duplicated email when scanner records disagree on SCIM identity', () => {
    const report = parseMembersReport(JSON.stringify([
      { email: 'conflict@example.com', scimId: 'scim-a', permission: 'read' },
      { email: 'CONFLICT@example.com', scimId: 'scim-b', permission: 'admin' }
    ]), { ...DEFAULT_ROLE_MAP }, { defaultWorkspaceRole: 'Viewer' });

    expect(report.members).toEqual([]);
    expect(report.unresolved).toEqual([
      expect.objectContaining({ identifier: 'conflict@example.com', reason: expect.stringContaining('conflicting SCIM') })
    ]);
  });

  it('assigns the inclusive fallback role to otherwise unmapped collaborators', () => {
    const members = parseMembersJson(JSON.stringify([
      { email: 'specialist@example.com', role_name: 'deloitte-api-specialist' },
      { email: 'contributor@example.com' }
    ]), { ...DEFAULT_ROLE_MAP }, 'Viewer');

    expect(members).toEqual([
      expect.objectContaining({
        email: 'specialist@example.com',
        githubPermission: 'deloitte-api-specialist',
        workspaceRole: 'Viewer'
      }),
      expect.objectContaining({
        email: 'contributor@example.com',
        workspaceRole: 'Viewer'
      })
    ]);
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
