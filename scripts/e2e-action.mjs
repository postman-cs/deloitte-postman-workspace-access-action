import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  POSTMAN_KEY,
  SCIM_KEY,
  assertSecretsMasked,
  readActionOutputs,
  runProcess,
  startSimulator,
  withTempDir
} from './e2e-testkit.mjs';

async function runAction(entrypoint, directory, baseUrl, workspaceId, members, options = {}) {
  const outputPath = join(directory, `${options.label ?? workspaceId}-output.txt`);
  const summaryPath = join(directory, `${options.label ?? workspaceId}-summary.md`);
  await writeFile(outputPath, '');
  await writeFile(summaryPath, '');
  const result = await runProcess(process.execPath, [entrypoint], {
    env: {
      NODE_ENV: '',
      GITHUB_ACTIONS: 'true',
      GITHUB_OUTPUT: outputPath,
      GITHUB_STEP_SUMMARY: summaryPath,
      'INPUT_WORKSPACE-ID': workspaceId,
      'INPUT_MEMBERS-JSON': JSON.stringify(members),
      'INPUT_MEMBERS-FILE': '',
      'INPUT_ROLE-MAP-JSON': options.roleMap ? JSON.stringify(options.roleMap) : '',
      'INPUT_POSTMAN-API-KEY': POSTMAN_KEY,
      'INPUT_POSTMAN-SCIM-API-KEY': SCIM_KEY,
      'INPUT_DRY-RUN': options.dryRun ? 'true' : 'false',
      'INPUT_FAIL-ON-PENDING-INVITES': options.failOnPending ? 'true' : 'false',
      'INPUT_POSTMAN-BASE-URL': `${baseUrl}/${options.scenario ?? 'action'}`
    }
  });
  const outputs = await readActionOutputs(outputPath);
  const stepSummary = await readFile(summaryPath, 'utf8');
  assertSecretsMasked(result, `${JSON.stringify(outputs)}\n${stepSummary}`);
  return { ...result, outputs, stepSummary };
}

const simulator = await startSimulator();
try {
  await withTempDir('deloitte-action-e2e-', async (directory) => {
    const action = await runAction('dist/index.cjs', directory, simulator.baseUrl, 'workspace-action', {
      collaborators: [
        { email: 'action.current@example.com', permissions: { admin: true, push: true, pull: true } },
        { email: 'action.new@example.com', permission: 'write', givenName: 'Action', familyName: 'New' }
      ]
    });
    assert.equal(action.code, 0, action.stderr);
    assert.equal(action.outputs['added-count'], '2');
    assert.equal(action.outputs['invited-count'], '1');
    assert.equal(action.outputs['pending-count'], '0');
    assert.equal(action.outputs['failed-count'], '0');
    assert.deepEqual(JSON.parse(action.outputs['summary-json']).counts, {
      added: 2, invited: 1, pending: 0, skipped: 0, failed: 0
    });
    assert.match(action.stepSummary, /Postman workspace access/);
    assert.match(action.stepSummary, /action\.new@example\.com/);
    assert.equal(simulator.requestsFor('action').filter((request) => request.path.endsWith('/roles')).length, 1);

    const pending = await runAction('dist/index.cjs', directory, simulator.baseUrl, 'workspace-action-pending', [
      { email: 'action.pending@example.com', permission: 'read' }
    ], { label: 'pending', scenario: 'pending', failOnPending: true });
    assert.equal(pending.code, 1);
    assert.equal(pending.outputs['pending-count'], '1');
    assert.equal(pending.outputs['failed-count'], '0');
    assert.match(pending.stdout, /invited user\(s\) are pending/);

    const dryRun = await runAction('dist/index.cjs', directory, simulator.baseUrl, 'workspace-action-dryrun', [
      { email: 'action.dryrun@example.com', permission: 'read' }
    ], { label: 'dryrun', scenario: 'action-dryrun', dryRun: true });
    assert.equal(dryRun.code, 0, dryRun.stderr);
    assert.equal(dryRun.outputs['skipped-count'], '1');
    assert.equal(simulator.requestsFor('action-dryrun').some((request) => ['POST', 'PATCH'].includes(request.method)), false);

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
