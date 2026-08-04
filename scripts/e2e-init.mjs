import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

import {
  POSTMAN_KEY,
  SCIM_KEY,
  assertSecretsMasked,
  runProcess,
  startSimulator,
  withTempDir,
  writeJson
} from './e2e-testkit.mjs';

const simulator = await startSimulator();
try {
  await withTempDir('deloitte-init-e2e-', async (root) => {
    const consumer = join(root, 'Deloitte Pipeline');
    await mkdir(consumer);
    const artifactRoot = join(consumer, 'artifacts');
    await mkdir(artifactRoot);
    await writeJson(join(artifactRoot, 'github-scanner-output.json'), { collaborators: [
      { email: 'existing.admin@example.com', permission: 'admin' },
      { email: 'init.new@example.com', permission: 'read' }
    ] });

    const install = await runProcess('bash', ['scripts/deloitte-init.sh', consumer]);
    assert.equal(install.code, 0, install.stderr);
    assert.match(install.stdout, /Installed Deloitte Postman workspace access starter kit/);

    const actionRoot = join(consumer, '.github/actions/deloitte-postman-workspace-access');
    const workflowPath = join(consumer, '.github/workflows/deloitte-postman-workspace-access.yml');
    const doctorPath = join(consumer, 'scripts/deloitte-postman-doctor.sh');
    const runbookPath = join(consumer, 'docs/deloitte-postman-workspace-access.md');
    await Promise.all([
      access(join(actionRoot, 'action.yml')),
      access(join(actionRoot, 'dist/index.cjs')),
      access(join(actionRoot, 'dist/cli.cjs'), constants.X_OK),
      access(workflowPath),
      access(doctorPath, constants.X_OK),
      access(runbookPath)
    ]);

    const workflow = parse(await readFile(workflowPath, 'utf8'));
    assert(workflow.on.workflow_call);
    assert.equal(workflow.jobs.reconcile.steps.at(-1).uses, './.github/actions/deloitte-postman-workspace-access');
    assert.equal(workflow.jobs.reconcile.steps[1].uses, 'actions/download-artifact@v8');

    const doctor = await runProcess(doctorPath, [
      '--workspace-id', 'workspace-init',
      '--scanner-search-root', artifactRoot,
      '--postman-base-url', `${simulator.baseUrl}/init`
    ], {
      cwd: consumer,
      env: { POSTMAN_API_KEY: POSTMAN_KEY, POSTMAN_SCIM_API_KEY: SCIM_KEY }
    });
    assert.equal(doctor.code, 0, doctor.stderr);
    assertSecretsMasked(doctor);
    const report = JSON.parse(doctor.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.scanner.members, 2);
    assert.equal(simulator.requestsFor('init').every((request) => request.method === 'GET'), true);

    const reinstall = await runProcess('bash', ['scripts/deloitte-init.sh', consumer]);
    assert.equal(reinstall.code, 73);
    assert.match(reinstall.stderr, /already exists/);

    await writeFile(runbookPath, 'stale\n');
    const upgrade = await runProcess('bash', ['scripts/deloitte-init.sh', consumer, '--upgrade']);
    assert.equal(upgrade.code, 0, upgrade.stderr);
    assert.match(await readFile(runbookPath, 'utf8'), /Sharooq's operating path/);
  });

  process.stdout.write('Sharooq starter kit e2e: install, workflow, doctor, overwrite protection, and upgrade passed.\n');
} finally {
  await simulator.close();
}
