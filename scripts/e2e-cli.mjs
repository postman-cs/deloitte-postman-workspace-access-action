import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  POSTMAN_KEY,
  POSTMAN_ACCESS_TOKEN,
  SCIM_KEY,
  NOTIFICATION_TOKEN,
  assertSecretsMasked,
  runProcess,
  startSimulator,
  withTempDir,
  writeJson
} from './e2e-testkit.mjs';

function runCli(baseUrl, workspaceId, members, options = {}) {
  const args = ['dist/cli.cjs'];
  if (options.command) args.push(options.command);
  args.push('--workspace-id', workspaceId);
  if (!options.autoDiscover) {
    args.push(
      options.membersFile ? '--members-file' : '--members-json',
      options.membersFile ?? JSON.stringify(members)
    );
  }
  if (options.scannerSearchRoot) args.push('--scanner-search-root', options.scannerSearchRoot);
  args.push('--postman-base-url', `${baseUrl}/${options.scenario ?? workspaceId}`);
  if (options.roleMap) args.push('--role-map-json', JSON.stringify(options.roleMap));
  if (options.defaultWorkspaceRole) args.push('--default-workspace-role', options.defaultWorkspaceRole);
  if (options.invalidMemberPolicy) args.push('--invalid-member-policy', options.invalidMemberPolicy);
  if (options.identityMapFile) args.push('--identity-map-file', options.identityMapFile);
  if (options.excludeBots) args.push('--exclude-bots');
  if (options.workspaceUrl) args.push('--postman-workspace-url', options.workspaceUrl);
  if (options.notificationsFile) args.push('--notifications-file', options.notificationsFile);
  if (options.dryRun) args.push('--dry-run');
  if (options.failOnPending) args.push('--fail-on-pending-invites');
  return runProcess(process.execPath, args, {
    env: {
      POSTMAN_API_KEY: options.postmanKey ?? POSTMAN_KEY,
      POSTMAN_ACCESS_TOKEN: POSTMAN_ACCESS_TOKEN,
      POSTMAN_SCIM_API_KEY: options.scimKey === null ? '' : options.scimKey ?? SCIM_KEY,
      GITHUB_REPOSITORY: 'deloitte/arbiter',
      GITHUB_RUN_ID: '424242',
      DELOITTE_NOTIFICATION_WEBHOOK_URL: options.notificationScenario
        ? `${baseUrl}/${options.notificationScenario}/email-batches`
        : '',
      DELOITTE_NOTIFICATION_WEBHOOK_TOKEN: options.notificationScenario ? NOTIFICATION_TOKEN : ''
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
        { email: 'custom.role@example.com', scimId: 'scim-custom-role', permission: 'contribute' },
        {
          email: 'custom.fallback@example.com',
          scimId: 'scim-custom-fallback',
          role_name: 'api-contributor',
          permissions: { push: true, pull: true }
        }
      ]
    };
    const membersFile = join(directory, 'scanner-output.json');
    const notificationsFile = join(directory, 'notifications.json');
    await writeJson(membersFile, successMembers);
    const success = await runCli(simulator.baseUrl, 'workspace-success', successMembers, {
      scenario: 'success',
      membersFile,
      roleMap: { admin: 'Admin', write: 'Editor', read: 'Viewer', contribute: 'Editor' },
      notificationScenario: 'notification-cli',
      notificationsFile,
      workspaceUrl: 'https://go.postman.co/workspace/arbiter'
    });
    assert.equal(success.code, 0, success.stderr);
    assertSecretsMasked(success);
    const successSummary = JSON.parse(success.stdout);
    assert.deepEqual(successSummary.counts, {
      added: 7,
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
    assert.equal(successSummary.results.find((item) => item.email === 'custom.fallback@example.com').workspaceRole, 'Editor');
    const notificationEnvelope = JSON.parse(await readFile(notificationsFile, 'utf8'));
    assert.equal(notificationEnvelope.notifications.length, 7);
    assert.equal(notificationEnvelope.sourceRepository, 'deloitte/arbiter');
    assert.equal(simulator.requestsFor('notification-cli')[0].body.notifications.length, 7);
    assert.equal(simulator.requestsFor('notification-cli')[0].idempotencyKey, 'deloitte-postman:workspace-success:424242');

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
      { id: 'scim-custom-role', role: '2' },
      { id: 'scim-custom-fallback', role: '2' }
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

    const doctorRoot = join(directory, 'doctor-artifact');
    const doctorFile = join(doctorRoot, 'github-scanner-output.json');
    await mkdir(doctorRoot);
    await writeJson(doctorFile, { collaborators: [
      { email: 'existing.admin@example.com', permission: 'admin' },
      { email: 'doctor.new@example.com', permission: 'read' }
    ] });
    const doctor = await runCli(simulator.baseUrl, 'workspace-doctor', undefined, {
      command: 'doctor',
      autoDiscover: true,
      scannerSearchRoot: doctorRoot,
      scenario: 'doctor'
    });
    assert.equal(doctor.code, 0, doctor.stderr);
    assertSecretsMasked(doctor);
    const doctorReport = JSON.parse(doctor.stdout);
    assert.equal(doctorReport.ok, true);
    assert.equal(doctorReport.workspace.name, 'Deloitte QA Workspace');
    assert.equal(doctorReport.scanner.members, 2);
    assert.equal(doctorReport.plan.dryRun, true);
    assert.equal(doctorReport.plan.counts.skipped, 2);
    assert.equal(doctorReport.checks.every((check) => check.status === 'passed'), true);
    assert.match(doctor.stderr, /Auto-discovered scanner output/);
    assert.equal(
      simulator.requestsFor('doctor').every((request) => request.method === 'GET'),
      true
    );

    const doctorWithoutScim = await runCli(simulator.baseUrl, 'workspace-doctor-no-scim', undefined, {
      command: 'doctor',
      autoDiscover: true,
      scannerSearchRoot: doctorRoot,
      scenario: 'doctor-no-scim',
      scimKey: null
    });
    assert.equal(doctorWithoutScim.code, 1);
    assert.match(doctorWithoutScim.stderr, /POSTMAN_SCIM_API_KEY is required for doctor mode/);
    assert.equal(
      simulator.requestsFor('doctor-no-scim').every((request) => request.method === 'GET'),
      true
    );

    const validate = await runProcess(process.execPath, [
      'dist/cli.cjs',
      'validate',
      '--scanner-search-root', doctorRoot
    ], { env: { POSTMAN_API_KEY: '', POSTMAN_SCIM_API_KEY: '' } });
    assert.equal(validate.code, 0, validate.stderr);
    const validationReport = JSON.parse(validate.stdout);
    assert.equal(validationReport.ok, true);
    assert.equal(validationReport.scanner.uniqueMembers, 2);
    assert.equal(validationReport.scanner.requiringScimLookup, 2);
    assert.deepEqual(validationReport.workspaceRoles, { Admin: 1, Viewer: 1 });
    assert.equal(simulator.requestsFor('validate').length, 0);

    const invalidValidation = await runProcess(process.execPath, [
      'dist/cli.cjs',
      'validate',
      '--members-json', JSON.stringify([{ login: 'missing-email', permission: 'read' }])
    ], { env: { POSTMAN_API_KEY: '', POSTMAN_SCIM_API_KEY: '' } });
    assert.equal(invalidValidation.code, 0, invalidValidation.stderr);
    assert.equal(JSON.parse(invalidValidation.stdout).scanner.unresolved, 1);
    assert.match(invalidValidation.stderr, /valid corporate email/);

    const invalid = await runCli(simulator.baseUrl, 'workspace-invalid', [
      { email: 'not-an-email', permission: 'read' }
    ], { scenario: 'invalid', invalidMemberPolicy: 'fail' });
    assert.equal(invalid.code, 1);
    assert.match(invalid.stderr, /valid corporate email/);
    assert.equal(simulator.requestsFor('invalid').length, 0);

    const identityMapFile = join(directory, 'identity-map.json');
    await writeJson(identityMapFile, { 'mapped-login': 'mapped.user@example.com' });
    const resilient = await runCli(simulator.baseUrl, 'workspace-resilient', [
      { login: 'mapped-login', permission: 'write' },
      { login: 'missing-email', permission: 'read' },
      { login: 'dependabot[bot]', type: 'Bot', permission: 'write' }
    ], {
      scenario: 'resilient',
      identityMapFile,
      excludeBots: true
    });
    assert.equal(resilient.code, 0, resilient.stderr);
    const resilientSummary = JSON.parse(resilient.stdout);
    assert.equal(resilientSummary.counts.added, 1);
    assert.equal(resilientSummary.scanner.detected, 3);
    assert.equal(resilientSummary.scanner.unresolved.length, 1);
    assert.equal(resilientSummary.scanner.excluded.length, 1);

    const missingKey = await runProcess(process.execPath, [
      'dist/cli.cjs', '--workspace-id', 'workspace-missing-key', '--members-json', '[]'
    ], { env: { POSTMAN_API_KEY: '', POSTMAN_SCIM_API_KEY: '' } });
    assert.equal(missingKey.code, 1);
    assert.match(missingKey.stderr, /POSTMAN_API_KEY is required/);

    const unconfirmedNotification = await runProcess(process.execPath, [
      'dist/cli.cjs', 'notify-test',
      '--email', 'sharooq@example.com',
      '--workspace-id', 'workspace-notify-test'
    ], {
      env: { DELOITTE_NOTIFICATION_WEBHOOK_URL: `${simulator.baseUrl}/notification-notify-test/email-batches` }
    });
    assert.equal(unconfirmedNotification.code, 1);
    assert.match(unconfirmedNotification.stderr, /SEND_TEST_NOTIFICATION/);
    assert.equal(simulator.requestsFor('notification-notify-test').length, 0);

    const notificationTest = await runProcess(process.execPath, [
      'dist/cli.cjs', 'notify-test',
      '--email', 'sharooq@example.com',
      '--workspace-id', 'workspace-notify-test',
      '--allowed-domain', 'example.com',
      '--confirm', 'SEND_TEST_NOTIFICATION'
    ], {
      env: {
        DELOITTE_NOTIFICATION_WEBHOOK_URL: `${simulator.baseUrl}/notification-notify-test/email-batches`,
        DELOITTE_NOTIFICATION_WEBHOOK_TOKEN: NOTIFICATION_TOKEN
      }
    });
    assert.equal(notificationTest.code, 0, notificationTest.stderr);
    assert.equal(JSON.parse(notificationTest.stdout).accepted, 1);
    assert.equal(simulator.requestsFor('notification-notify-test').length, 1);
    assert.match(simulator.requestsFor('notification-notify-test')[0].idempotencyKey, /^deloitte-postman:test:/);

    const help = await runProcess(process.execPath, ['dist/cli.cjs', '--help'], {
      env: { POSTMAN_API_KEY: '', POSTMAN_SCIM_API_KEY: '' }
    });
    assert.equal(help.code, 0, help.stderr);
    assert.match(help.stdout, /postman-workspace-access/);
  });

  process.stdout.write('CLI e2e matrix: lifecycle, credential-free validation, doctor, discovery, retry, fallback, and exit-code paths passed.\n');
} finally {
  await simulator.close();
}
