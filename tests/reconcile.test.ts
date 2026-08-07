import { describe, expect, it, vi } from 'vitest';

import { PostmanClient } from '../src/postman-client.js';
import { reconcileWorkspaceAccess } from '../src/reconcile.js';
import type { FetchLike, NormalizedMember, Reporter } from '../src/types.js';

const member: NormalizedMember = {
  email: 'dev@example.com',
  githubLogin: 'dev',
  githubPermission: 'write',
  externalId: 'dev',
  workspaceRole: 'Editor'
};

const reporter: Reporter = {
  info: vi.fn(),
  warning: vi.fn()
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function roleCatalog(): Response {
  return json(200, {
    roles: [
      { id: '1', displayName: 'Viewer' },
      { id: '2', displayName: 'Editor' },
      { id: '3', displayName: 'Admin' }
    ]
  });
}

describe('workspace access reconciliation', () => {
  it('adds an existing team user with a SCIM identifier', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: FetchLike = vi.fn(async (input, init) => {
      const url = String(input);
      calls.push({ url, ...(init ? { init } : {}) });
      if (url.endsWith('/workspace-roles')) return roleCatalog();
      if (url.includes('/scim/v2/Users?')) {
        return json(200, { Resources: [{ id: 'scim-1', userName: member.email, active: true }] });
      }
      if (url.endsWith('/workspaces/ws-1/roles')) return json(200, { roles: [] });
      throw new Error(`Unexpected request ${url}`);
    });
    const client = new PostmanClient({
      postmanApiKey: 'pmak-test',
      postmanAccessToken: 'access-test',
      scimApiKey: 'scim-test',
      fetcher
    });

    const summary = await reconcileWorkspaceAccess(client, {
      workspaceId: 'ws-1',
      members: [member],
      dryRun: false
    }, reporter);

    expect(summary.counts).toEqual({ added: 1, invited: 0, pending: 0, skipped: 0, failed: 0 });
    const patch = calls.find((call) => call.url.endsWith('/workspaces/ws-1/roles'));
    expect(patch?.init?.headers).toMatchObject({
      Authorization: 'Bearer access-test',
      'x-api-key': 'pmak-test',
      identifierType: 'scim'
    });
    expect(JSON.parse(String(patch?.init?.body))).toEqual({
      roles: [{ op: 'add', path: '/user', value: [{ id: 'scim-1', role: '2' }] }]
    });
  });

  it('provisions a missing user and then adds the user to the workspace', async () => {
    const methods: string[] = [];
    const fetcher: FetchLike = vi.fn(async (input, init) => {
      const url = String(input);
      methods.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`);
      if (url.endsWith('/workspace-roles')) return roleCatalog();
      if (url.includes('/scim/v2/Users?')) return json(200, { Resources: [] });
      if (url.endsWith('/scim/v2/Users') && init?.method === 'POST') {
        return json(201, { id: 'new-scim', userName: member.email, active: true });
      }
      if (url.endsWith('/workspaces/ws-1/roles')) return json(200, { roles: [] });
      throw new Error(`Unexpected request ${url}`);
    });
    const client = new PostmanClient({
      postmanApiKey: 'pmak-test',
      scimApiKey: 'scim-test',
      fetcher
    });

    const summary = await reconcileWorkspaceAccess(client, {
      workspaceId: 'ws-1',
      members: [member],
      dryRun: false
    }, reporter);

    expect(methods).toContain('POST /scim/v2/Users');
    expect(summary.counts).toEqual({ added: 1, invited: 1, pending: 0, skipped: 0, failed: 0 });
    expect(summary.results[0]).toMatchObject({ lifecycle: 'provisioned', workspaceAccess: 'added' });
  });

  it('handles a SCIM create race without counting an existing user as invited', async () => {
    let lookupCount = 0;
    const fetcher: FetchLike = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/workspace-roles')) return roleCatalog();
      if (url.includes('/scim/v2/Users?')) {
        lookupCount += 1;
        return lookupCount === 1
          ? json(200, { Resources: [] })
          : json(200, { Resources: [{ id: 'race-scim', userName: member.email, active: true }] });
      }
      if (url.endsWith('/scim/v2/Users') && init?.method === 'POST') {
        return json(409, { error: 'User already exists' });
      }
      if (url.endsWith('/workspaces/ws-1/roles')) return json(200, { roles: [] });
      throw new Error(`Unexpected request ${url}`);
    });
    const client = new PostmanClient({
      postmanApiKey: 'pmak-test',
      scimApiKey: 'scim-test',
      fetcher
    });

    const summary = await reconcileWorkspaceAccess(client, {
      workspaceId: 'ws-1',
      members: [member],
      dryRun: false
    }, reporter);

    expect(summary.counts).toEqual({ added: 1, invited: 0, pending: 0, skipped: 0, failed: 0 });
    expect(summary.results[0]).toMatchObject({ lifecycle: 'existing', workspaceAccess: 'added' });
  });

  it('reactivates an inactive SCIM user before assigning workspace access', async () => {
    const methods: string[] = [];
    const fetcher: FetchLike = vi.fn(async (input, init) => {
      const url = String(input);
      methods.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`);
      if (url.endsWith('/workspace-roles')) return roleCatalog();
      if (url.includes('/scim/v2/Users?')) {
        return json(200, { Resources: [{ id: 'inactive-scim', userName: member.email, active: false }] });
      }
      if (url.endsWith('/scim/v2/Users/inactive-scim') && init?.method === 'PATCH') {
        return json(200, { id: 'inactive-scim', userName: member.email, active: true });
      }
      if (url.endsWith('/workspaces/ws-1/roles')) return json(200, { roles: [] });
      throw new Error(`Unexpected request ${url}`);
    });
    const client = new PostmanClient({
      postmanApiKey: 'pmak-test',
      scimApiKey: 'scim-test',
      fetcher
    });

    const summary = await reconcileWorkspaceAccess(client, {
      workspaceId: 'ws-1',
      members: [member],
      dryRun: false
    }, reporter);

    expect(methods).toContain('PATCH /scim/v2/Users/inactive-scim');
    expect(summary.counts).toEqual({ added: 1, invited: 0, pending: 0, skipped: 0, failed: 0 });
    expect(summary.results[0]).toMatchObject({ lifecycle: 'reactivated', workspaceAccess: 'added' });
  });

  it('reports an invited user as pending when Postman cannot assign the role yet', async () => {
    const fetcher: FetchLike = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/workspace-roles')) return roleCatalog();
      if (url.includes('/scim/v2/Users?')) return json(200, { Resources: [] });
      if (url.endsWith('/scim/v2/Users') && init?.method === 'POST') {
        return json(201, { id: 'pending-scim', userName: member.email, active: true });
      }
      if (url.endsWith('/workspaces/ws-1/roles')) return json(422, { error: 'User has not joined the team' });
      throw new Error(`Unexpected request ${url}`);
    });
    const client = new PostmanClient({
      postmanApiKey: 'pmak-test',
      scimApiKey: 'scim-test',
      fetcher
    });

    const summary = await reconcileWorkspaceAccess(client, {
      workspaceId: 'ws-1',
      members: [member],
      dryRun: false
    }, reporter);

    expect(summary.counts).toEqual({ added: 0, invited: 1, pending: 1, skipped: 0, failed: 0 });
    expect(summary.results[0]?.message).toMatch(/after the user accepts/);
  });

  it('makes no write calls in dry-run mode', async () => {
    const fetcher: FetchLike = vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith('/workspace-roles')) return roleCatalog();
      if (url.includes('/scim/v2/Users?')) return json(200, { Resources: [] });
      throw new Error(`Unexpected write ${url}`);
    });
    const client = new PostmanClient({
      postmanApiKey: 'pmak-test',
      scimApiKey: 'scim-test',
      fetcher
    });

    const summary = await reconcileWorkspaceAccess(client, {
      workspaceId: 'ws-1',
      members: [member],
      dryRun: true
    }, reporter);

    expect(summary.counts).toEqual({ added: 0, invited: 0, pending: 0, skipped: 1, failed: 0 });
    expect(summary.results[0]).toMatchObject({ lifecycle: 'would-provision', workspaceAccess: 'would-add' });
  });

  it('fails only the missing user when no SCIM key is configured', async () => {
    const fetcher: FetchLike = vi.fn(async (input) => {
      if (String(input).endsWith('/workspace-roles')) return roleCatalog();
      throw new Error(`Unexpected request ${String(input)}`);
    });
    const client = new PostmanClient({ postmanApiKey: 'pmak-test', fetcher });

    const summary = await reconcileWorkspaceAccess(client, {
      workspaceId: 'ws-1',
      members: [member],
      dryRun: false
    }, reporter);

    expect(summary.counts.failed).toBe(1);
    expect(summary.results[0]?.message).toMatch(/SCIM API key/);
  });
});
