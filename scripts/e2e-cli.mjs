import assert from 'node:assert/strict';
import { join } from 'node:path';

import {
  POSTMAN_KEY,
  SCIM_KEY,
  assertSecretsMasked,
  runProcess,
  startSimulator,
  withTempDir,
  writeJson
} from './e2e-testkit.mjs';

function runCli(baseUrl, workspaceId, members, options = {}) {
  const args = [
    'dist/cli.cjs',
    '--workspace-id', workspaceId,
    options.membersFile ? '--members-file' : '--members-json',
    options.membersFile ?? JSON.stringify(members),
    '--postman-base-url', `${baseUrl}/${options.scenario ?? workspaceId}`
  ];
  if (options.roleMap) args.push('--role-map-json', JSON.stringify(options.roleMap));
  if (options.dryRun) args.push('--dry-run');
  if (options.failOnPending) args.push('--fail-on-pending-invites');
  return runProcess(process.execPath, args, {
    env: {
      POSTMAN_API_KEY: options.postmanKey ?? POSTMAN_KEY,
      POSTMAN_SCIM_API_KEY: options.scimKey === null ? '' : options.scimKey ?? SCIM_KEY
    }
  });
}

const simulator = await startSimulator();
try {
  await withTempDir('deloitte-cli-e2e-', async (directory) => {
    const successMembers = {
      schemaVersion: 1,
      repository: 'deloitte/arbiter',
      collaborators: [
        { email: 'existing.admin@example.com', permission: 'read' },
        { email: 'EXISTING.ADMIN@example.com', permissions: { admin: true, push: true, pull: true } },
        { email: 'inactive.editor@example.com', github_permission: 'write' },
        { email: 'new.viewer@example.com', role_name: 'read', login: 'new-viewer' },
        { email: 'provided.viewer@example.com', scim_id: 'scim-provided-viewer', workspace_role: 'Viewer' },
        { email: 'race.user@example.com', permission: 'write' },
        { email: 'custom.role@example.com', scimId: 'scim-custom-role', permission: 'contribute' }
      ]
    };
    const membersFile = join(directory, 'scanner-output.json');
    await writeJson(membersFile, successMembers);
    const success = await runCli(simulator.baseUrl, 'workspace-success', successMembers, {
      scenario: 'success',
      membersFile,
      roleMap: { admin: 'Admin', write: 'Editor', read: 'Viewer', contribute: 'Editor' }
    });
    assert.equal(success.code, 0, success.stderr);
    assertSecretsMasked(success);
    const successSummary = JSON.parse(success.stdout);
    assert.deepEqual(successSummary.counts, {
      added: 6,
      invited: 1,
      pending: 0,
      skipped: 0,
      failed: 0
    });
    assert.equal(successSummary.results.find((item) => item.email === 'existing.admin@example.com').workspaceRole, 'Admin');
    assert.equal(successSummary.results.find((item) => item.email === 'inactive.editor@example.com').lifecycle, 'reactivated');
    assert.equal(successSummary.results.find((item) => item.email === 'new.viewer@example.com').lifecycle, 'provisioned');
    assert.equal(successSummary.results.find((item) => item.email === 'race.user@example.com').lifecycle, 'existing');
    assert.equal(successSummary.results.find((item) => item.email === 'provided.viewer@example.com').lifecycle, 'provided-scim-id');

    const successRequests = simulator.requestsFor('success');
    assert.equal(successRequests.filter((request) => request.method === 'POST').length, 2);
    assert.equal(successRequests.filter((request) => request.path.startsWith('/scim/v2/Users/scim-inactive-editor')).length, 1);
    const successPatch = successRequests.find((request) => request.path === '/workspaces/workspace-success/roles');
    assert(successPatch);
    assert.deepEqual(successPatch.body.roles[0].value, [
      { id: 'scim-existing-admin', role: '3' },
      { id: 'scim-inactive-editor', role: '2' },
      { id: 'scim-new-viewer', role: '1' },
      { id: 'scim-provided-viewer', role: '1' },
      { id: 'scim-race-user', role: '2' },
      { id: 'scim-custom-role', role: '2' }
    ]);

    const dryRunMembers = { members: [
      { email: 'inactive.editor@example.com', permission: 'write' },
      { email: 'new.dryrun@example.com', permission: 'read' },
      { email: 'provided.dryrun@example.com', scimId: 'scim-provided-dryrun', postmanRole: 'Admin' }
    ] };
    const dryRun = await runCli(simulator.baseUrl, 'workspace-dryrun', dryRunMembers, {
      scenario: 'dryrun',
      dryRun: true
    });
    assert.equal(dryRun.code, 0, dryRun.stderr);
    assertSecretsMasked(dryRun);
    const dryRunSummary = JSON.parse(dryRun.stdout);
    assert.deepEqual(dryRunSummary.counts, { added: 0, invited: 0, pending: 0, skipped: 3, failed: 0 });
    assert.equal(dryRunSummary.results.find((item) => item.email === 'inactive.editor@example.com').lifecycle, 'would-reactivate');
    assert.equal(simulator.requestsFor('dryrun').some((request) => ['POST', 'PATCH'].includes(request.method)), false);

    const pendingDefault = await runCli(simulator.baseUrl, 'workspace-pending', [
      { email: 'new.pending1@example.com', permission: 'write' }
    ], { scenario: 'pending' });
    assert.equal(pendingDefault.code, 0, pendingDefault.stderr);
    assert.deepEqual(JSON.parse(pendingDefault.stdout).counts, {
      added: 0, invited: 1, pending: 1, skipped: 0, failed: 0
    });

    const pendingBlocking = await runCli(simulator.baseUrl, 'workspace-pending', [
      { email: 'new.pending2@example.com', permission: 'write' }
    ], { scenario: 'pending', failOnPending: true });
    assert.equal(pendingBlocking.code, 2, pendingBlocking.stderr);
    assert.equal(JSON.parse(pendingBlocking.stdout).counts.pending, 1);

    const partial = await runCli(simulator.baseUrl, 'workspace-partial', [
      { email: 'existing.good@example.com', permission: 'admin' },
      { email: 'new.pending@example.com', permission: 'write' },
      { email: 'existing.bad@example.com', permission: 'read' }
    ], { scenario: 'partial' });
    assert.equal(partial.code, 1, partial.stderr);
    assert.match(partial.stderr, /batch failed; retrying 3 user/);
    assert.deepEqual(JSON.parse(partial.stdout).counts, {
      added: 1, invited: 1, pending: 1, skipped: 0, failed: 1
    });
    assert.equal(simulator.requestsFor('partial').filter((request) => request.path.endsWith('/roles')).length, 6);

    const retry = await runCli(simulator.baseUrl, 'workspace-retry', [
      { email: 'retry@example.com', scimId: 'scim-retry', workspaceRole: 'Viewer' }
    ], { scenario: 'retry' });
    assert.equal(retry.code, 0, retry.stderr);
    assert.equal(JSON.parse(retry.stdout).counts.added, 1);
    assert.equal(simulator.requestsFor('retry').filter((request) => request.path === '/workspace-roles').length, 2);
    assert.equal(simulator.requestsFor('retry').filter((request) => request.path.endsWith('/roles')).length, 2);

    const noScim = await runCli(simulator.baseUrl, 'workspace-no-scim', [
      { email: 'missing.no-scim@example.com', permission: 'read' }
    ], { scenario: 'no-scim', scimKey: null });
    assert.equal(noScim.code, 1, noScim.stderr);
    assert.equal(JSON.parse(noScim.stdout).counts.failed, 1);
    assert.match(noScim.stdout, /SCIM API key is required/);
    assert.equal(simulator.requestsFor('no-scim').some((request) => request.path.startsWith('/scim/')), false);

    const invalid = await runCli(simulator.baseUrl, 'workspace-invalid', [
      { email: 'not-an-email', permission: 'read' }
    ], { scenario: 'invalid' });
    assert.equal(invalid.code, 1);
    assert.match(invalid.stderr, /valid email address/);
    assert.equal(simulator.requestsFor('invalid').length, 0);

    const missingKey = await runProcess(process.execPath, [
      'dist/cli.cjs', '--workspace-id', 'workspace-missing-key', '--members-json', '[]'
    ], { env: { POSTMAN_API_KEY: '', POSTMAN_SCIM_API_KEY: '' } });
    assert.equal(missingKey.code, 1);
    assert.match(missingKey.stderr, /POSTMAN_API_KEY is required/);

    const help = await runProcess(process.execPath, ['dist/cli.cjs', '--help'], {
      env: { POSTMAN_API_KEY: '', POSTMAN_SCIM_API_KEY: '' }
    });
    assert.equal(help.code, 0, help.stderr);
    assert.match(help.stdout, /postman-workspace-access/);
  });

  process.stdout.write('CLI e2e matrix: 10 lifecycle, retry, fallback, validation, and exit-code paths passed.\n');
} finally {
  await simulator.close();
}
