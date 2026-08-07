import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  POSTMAN_KEY,
  POSTMAN_ACCESS_TOKEN,
  SCIM_KEY,
  NOTIFICATION_TOKEN,
  assertSecretsMasked,
  readActionOutputs,
  runProcess,
  startSimulator,
  withTempDir
} from './e2e-testkit.mjs';

async function runAction(entrypoint, directory, baseUrl, workspaceId, members, options = {}) {
  const outputPath = join(directory, `${options.label ?? workspaceId}-output.txt`);
  const summaryPath = join(directory, `${options.label ?? workspaceId}-summary.md`);
  const summaryJsonPath = options.writeSummary
    ? join(directory, `${options.label ?? workspaceId}-summary.json`)
    : '';
  const notificationsJsonPath = options.writeNotifications
    ? join(directory, `${options.label ?? workspaceId}-notifications.json`)
    : '';
  await writeFile(outputPath, '');
  await writeFile(summaryPath, '');
  const result = await runProcess(process.execPath, [entrypoint], {
    env: {
      NODE_ENV: '',
      GITHUB_ACTIONS: 'true',
      GITHUB_OUTPUT: outputPath,
      GITHUB_STEP_SUMMARY: summaryPath,
      GITHUB_REPOSITORY: 'deloitte/api-platform',
      GITHUB_RUN_ID: '8675309',
      GITHUB_RUN_ATTEMPT: '1',
      'INPUT_WORKSPACE-ID': workspaceId,
      'INPUT_MEMBERS-JSON': options.autoDiscover ? '' : JSON.stringify(members),
      'INPUT_MEMBERS-FILE': '',
      'INPUT_CONFIG-FILE': options.configFile ?? '',
      'INPUT_SCANNER-SEARCH-ROOT': options.scannerSearchRoot ?? '',
      'INPUT_IDENTITY-MAP-FILE': options.identityMapFile ?? '',
      'INPUT_INVALID-MEMBER-POLICY': options.invalidMemberPolicy ?? '',
      'INPUT_EXCLUDE-BOTS': options.excludeBots ? 'true' : '',
      'INPUT_EXCLUDE-LOGINS-JSON': options.excludeLogins ? JSON.stringify(options.excludeLogins) : '',
      'INPUT_ROLE-MAP-JSON': options.roleMap ? JSON.stringify(options.roleMap) : '',
      'INPUT_DEFAULT-WORKSPACE-ROLE': options.defaultWorkspaceRole ?? '',
      'INPUT_POSTMAN-API-KEY': POSTMAN_KEY,
      'INPUT_POSTMAN-ACCESS-TOKEN': POSTMAN_ACCESS_TOKEN,
      'INPUT_POSTMAN-SCIM-API-KEY': SCIM_KEY,
      'INPUT_DRY-RUN': options.dryRun ? 'true' : 'false',
      'INPUT_FAIL-ON-PENDING-INVITES': options.failOnPending ? 'true' : 'false',
      'INPUT_POSTMAN-BASE-URL': `${baseUrl}/${options.scenario ?? 'action'}`,
      'INPUT_SUMMARY-FILE': summaryJsonPath,
      'INPUT_POSTMAN-WORKSPACE-URL': options.workspaceUrl ?? '',
      'INPUT_NOTIFICATION-SUBJECT': options.notificationSubject ?? '',
      'INPUT_NOTIFICATIONS-FILE': notificationsJsonPath,
      'INPUT_NOTIFICATION-WEBHOOK-URL': options.notificationScenario
        ? `${baseUrl}/${options.notificationScenario}/email-batches`
        : '',
      'INPUT_NOTIFICATION-WEBHOOK-TOKEN': options.notificationScenario ? NOTIFICATION_TOKEN : ''
    }
  });
  const outputs = await readActionOutputs(outputPath);
  const stepSummary = await readFile(summaryPath, 'utf8');
  const summaryFile = summaryJsonPath ? await readFile(summaryJsonPath, 'utf8') : '';
  const notificationsFile = notificationsJsonPath ? await readFile(notificationsJsonPath, 'utf8') : '';
  assertSecretsMasked(result, `${JSON.stringify(outputs)}\n${stepSummary}\n${summaryFile}\n${notificationsFile}`);
  return { ...result, outputs, stepSummary, summaryFile, notificationsFile };
}

const simulator = await startSimulator();
try {
  await withTempDir('deloitte-action-e2e-', async (directory) => {
    const action = await runAction('dist/index.cjs', directory, simulator.baseUrl, 'workspace-action', {
      collaborators: [
        { email: 'action.current@example.com', permissions: { admin: true, push: true, pull: true } },
        { email: 'action.new@example.com', permission: 'write', givenName: 'Action', familyName: 'New' },
        { email: 'action.specialist@example.com', role_name: 'deloitte-api-specialist' }
      ]
    }, {
      writeSummary: true,
      writeNotifications: true,
      notificationScenario: 'notification-action',
      workspaceUrl: 'https://go.postman.co/workspace/deloitte-api-platform'
    });
    assert.equal(action.code, 0, action.stderr);
    assert.equal(action.outputs['added-count'], '3');
    assert.equal(action.outputs['invited-count'], '2');
    assert.equal(action.outputs['pending-count'], '0');
    assert.equal(action.outputs['failed-count'], '0');
    assert.equal(action.outputs['detected-count'], '3');
    assert.equal(action.outputs['resolved-count'], '3');
    assert.equal(action.outputs['unresolved-count'], '0');
    assert.equal(action.outputs['excluded-count'], '0');
    assert.equal(JSON.parse(action.outputs['metrics-json']).access.added, 3);
    assert.deepEqual(JSON.parse(action.outputs['summary-json']).counts, {
      added: 3, invited: 2, pending: 0, skipped: 0, failed: 0
    });
    assert.match(action.stepSummary, /Postman workspace access/);
    assert.match(action.stepSummary, /action\.new@example\.com/);
    assert.match(action.stepSummary, /\| Outcome \| Count \|/);
    assert.match(action.stepSummary, /\| User \| Workspace role \| Team lifecycle/);
    assert.equal(JSON.parse(action.summaryFile).workspaceId, 'workspace-action');
    assert.equal(action.outputs['summary-file'].endsWith('workspace-action-summary.json'), true);
    assert.equal(action.outputs['notification-count'], '3');
    assert.equal(action.outputs['notification-eligible-count'], '3');
    assert.equal(action.outputs['notification-delivered-count'], '3');
    assert.equal(action.outputs['notifications-file'].endsWith('workspace-action-notifications.json'), true);
    const renderedNotifications = JSON.parse(action.notificationsFile);
    assert.equal(renderedNotifications.notifications.length, 3);
    assert.equal(
      renderedNotifications.notifications.find(({ to }) => to === 'action.specialist@example.com').workspaceRole,
      'Viewer'
    );
    assert.equal(simulator.requestsFor('action').filter((request) => request.path.endsWith('/roles')).length, 1);
    const notificationRequest = simulator.requestsFor('notification-action')[0];
    assert(notificationRequest);
    assert.equal(notificationRequest.idempotencyKey, 'deloitte-postman:workspace-action:8675309:1');
    assert.equal(notificationRequest.body.notifications.length, 3);
    assert.match(notificationRequest.body.notifications[0].text, /Three useful ways to get started/);

    const pending = await runAction('dist/index.cjs', directory, simulator.baseUrl, 'workspace-action-pending', [
      { email: 'action.pending@example.com', permission: 'read' }
    ], {
      label: 'pending',
      scenario: 'pending',
      failOnPending: true,
      notificationScenario: 'notification-pending'
    });
    assert.equal(pending.code, 1);
    assert.equal(pending.outputs['pending-count'], '1');
    assert.equal(pending.outputs['failed-count'], '0');
    assert.equal(pending.outputs['notification-delivered-count'], '1');
    assert.equal(simulator.requestsFor('notification-pending')[0].body.notifications[0].status, 'invitation-pending');
    assert.match(pending.stdout, /invited user\(s\) are pending/);

    const dryRun = await runAction('dist/index.cjs', directory, simulator.baseUrl, 'workspace-action-dryrun', [
      { email: 'action.dryrun@example.com', permission: 'read' }
    ], {
      label: 'dryrun',
      scenario: 'action-dryrun',
      dryRun: true,
      writeNotifications: true,
      notificationScenario: 'notification-dryrun'
    });
    assert.equal(dryRun.code, 0, dryRun.stderr);
    assert.equal(dryRun.outputs['skipped-count'], '1');
    assert.equal(dryRun.outputs['notification-count'], '1');
    assert.equal(dryRun.outputs['notification-eligible-count'], '0');
    assert.equal(dryRun.outputs['notification-delivered-count'], '0');
    assert.equal(JSON.parse(dryRun.notificationsFile).notifications[0].send, false);
    assert.equal(simulator.requestsFor('action-dryrun').some((request) => ['POST', 'PATCH'].includes(request.method)), false);
    assert.equal(simulator.requestsFor('notification-dryrun').length, 0);

    const rejectedNotification = await runAction(
      'dist/index.cjs',
      directory,
      simulator.baseUrl,
      'workspace-notification-rejected',
      [{ email: 'action.current@example.com', permission: 'read' }],
      {
        label: 'notification-rejected',
        scenario: 'action-notification-rejected',
        notificationScenario: 'notification-rejected'
      }
    );
    assert.equal(rejectedNotification.code, 1);
    assert.equal(rejectedNotification.outputs['added-count'], '1');
    assert.match(rejectedNotification.stdout, /Notification gateway returned HTTP 400/);

    const discoveryRoot = join(directory, 'scanner-artifact');
    await mkdir(discoveryRoot);
    await writeFile(join(discoveryRoot, 'deloitte-github-scanner-output.json'), JSON.stringify({ collaborators: [
      { email: 'action.current@example.com', permission: 'admin' }
    ] }));
    const discovered = await runAction('dist/index.cjs', directory, simulator.baseUrl, 'workspace-discovered', undefined, {
      label: 'discovered',
      scenario: 'action-discovered',
      autoDiscover: true,
      scannerSearchRoot: discoveryRoot
    });
    assert.equal(discovered.code, 0, discovered.stderr);
    assert.equal(discovered.outputs['added-count'], '1');
    assert.equal(discovered.outputs['scanner-source'], join(discoveryRoot, 'deloitte-github-scanner-output.json'));
    assert.match(discovered.stdout, /Auto-discovered scanner output/);

    const resilient = await runAction('dist/index.cjs', directory, simulator.baseUrl, 'workspace-action-resilient', [
      { login: 'valid', email: 'action.current@example.com', permission: 'read' },
      { login: 'missing-email', permission: 'read' },
      { login: 'dependabot[bot]', type: 'Bot', permission: 'write' }
    ], {
      label: 'resilient',
      scenario: 'action-resilient',
      excludeBots: true
    });
    assert.equal(resilient.code, 0, resilient.stderr);
    assert.equal(resilient.outputs['detected-count'], '3');
    assert.equal(resilient.outputs['resolved-count'], '1');
    assert.equal(resilient.outputs['unresolved-count'], '1');
    assert.equal(resilient.outputs['excluded-count'], '1');
    assert.equal(JSON.parse(resilient.outputs['unresolved-json'])[0].githubLogin, 'missing-email');

    const missingInputPath = join(directory, 'missing-input-output.txt');
    const missingSummaryPath = join(directory, 'missing-input-summary.md');
    await writeFile(missingInputPath, '');
    await writeFile(missingSummaryPath, '');
    const missingInput = await runProcess(process.execPath, ['dist/index.cjs'], {
      env: {
        NODE_ENV: '',
        GITHUB_ACTIONS: 'true',
        GITHUB_OUTPUT: missingInputPath,
        GITHUB_STEP_SUMMARY: missingSummaryPath,
        'INPUT_WORKSPACE-ID': '',
        'INPUT_POSTMAN-API-KEY': POSTMAN_KEY
      }
    });
    assert.equal(missingInput.code, 1);
    assert.match(missingInput.stdout, /Input required and not supplied: workspace-id/);

    const consumer = join(directory, 'consumer');
    await mkdir(consumer);
    const vendor = await runProcess('bash', ['scripts/vendor-action.sh', consumer]);
    assert.equal(vendor.code, 0, vendor.stderr);
    const vendoredEntrypoint = join(
      consumer,
      '.github/actions/deloitte-postman-workspace-access/dist/index.cjs'
    );
    const vendored = await runAction(vendoredEntrypoint, directory, simulator.baseUrl, 'workspace-vendor', [
      { email: 'vendor.current@example.com', permission: 'admin' }
    ], { label: 'vendor', scenario: 'vendor' });
    assert.equal(vendored.code, 0, vendored.stderr);
    assert.equal(vendored.outputs['added-count'], '1');
    assert.equal(vendored.outputs['invited-count'], '0');
  });

  process.stdout.write('GitHub Action e2e matrix: outputs, summaries, pending gates, dry-run, and vendored runtime passed.\n');
} finally {
  await simulator.close();
}
