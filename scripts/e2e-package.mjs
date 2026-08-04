import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  POSTMAN_KEY,
  SCIM_KEY,
  assertSecretsMasked,
  runProcess,
  startSimulator,
  withTempDir
} from './e2e-testkit.mjs';

const simulator = await startSimulator();
try {
  await withTempDir('deloitte-package-e2e-', async (directory) => {
    const sourcePackage = JSON.parse(await readFile('package.json', 'utf8'));
    const pack = await runProcess('npm', ['pack', '--json', '--pack-destination', directory]);
    assert.equal(pack.code, 0, pack.stderr);
    const metadata = JSON.parse(pack.stdout);
    assert.equal(metadata.length, 1);
    const tarball = join(directory, metadata[0].filename);
    const packageRoot = join(directory, 'installed');
    const install = await runProcess('npm', [
      'install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', packageRoot, tarball
    ]);
    assert.equal(install.code, 0, install.stderr);

    const installedPackage = JSON.parse(await readFile(
      join(packageRoot, 'node_modules/@postman-cse/deloitte-workspace-access/package.json'),
      'utf8'
    ));
    assert.equal(installedPackage.name, '@postman-cse/deloitte-workspace-access');
    assert.equal(installedPackage.version, sourcePackage.version);
    assert.equal(installedPackage.bin['postman-workspace-access'], 'dist/cli.cjs');
    await readFile(join(packageRoot, 'node_modules/@postman-cse/deloitte-workspace-access/action.yml'));
    await readFile(join(packageRoot, 'node_modules/@postman-cse/deloitte-workspace-access/QUICKSTART.md'));
    await readFile(join(packageRoot, 'node_modules/@postman-cse/deloitte-workspace-access/BUILD_LOG.md'));
    await readFile(join(packageRoot, 'node_modules/@postman-cse/deloitte-workspace-access/schemas/deloitte-github-scanner-output.schema.json'));
    await readFile(join(packageRoot, 'node_modules/@postman-cse/deloitte-workspace-access/scripts/deloitte-init.sh'));
    await readFile(join(packageRoot, 'node_modules/@postman-cse/deloitte-workspace-access/templates/deloitte-postman-workspace-access.yml'));
    await readFile(join(packageRoot, 'node_modules/@postman-cse/deloitte-workspace-access/templates/deloitte-postman-pending-reconcile.yml'));
    await readFile(join(packageRoot, 'node_modules/@postman-cse/deloitte-workspace-access/templates/logic-app/deloitte-postman-notifier.workflow.json'));
    await readFile(join(packageRoot, 'node_modules/@postman-cse/deloitte-workspace-access/templates/deloitte-postman-onboarding-email.md'));
    await readFile(join(packageRoot, 'node_modules/@postman-cse/deloitte-workspace-access/docs/SHAROOQ-RUNBOOK.md'));
    await readFile(join(packageRoot, 'node_modules/@postman-cse/deloitte-workspace-access/docs/POSTMAN-PREREQUISITES.md'));
    await readFile(join(packageRoot, 'node_modules/@postman-cse/deloitte-workspace-access/docs/SANDBOX-SMOKE.md'));
    await readFile(join(packageRoot, 'node_modules/@postman-cse/deloitte-workspace-access/docs/NOTIFICATIONS.md'));
    await readFile(join(packageRoot, 'node_modules/@postman-cse/deloitte-workspace-access/SECURITY.md'));

    const packagedConsumer = join(directory, 'packaged-consumer');
    await mkdir(packagedConsumer);
    const packagedInstall = await runProcess('bash', [
      join(packageRoot, 'node_modules/@postman-cse/deloitte-workspace-access/scripts/deloitte-init.sh'),
      packagedConsumer
    ]);
    assert.equal(packagedInstall.code, 0, packagedInstall.stderr);
    await readFile(join(packagedConsumer, '.github/actions/deloitte-postman-workspace-access/dist/index.cjs'));
    await readFile(join(packagedConsumer, '.github/workflows/deloitte-postman-workspace-access.yml'));
    await readFile(join(packagedConsumer, '.github/workflows/deloitte-postman-pending-reconcile.yml'));
    await readFile(join(packagedConsumer, '.deloitte-postman.yml'));

    const binary = join(packageRoot, 'node_modules/.bin/postman-workspace-access');
    const result = await runProcess(binary, [
      '--workspace-id', 'workspace-package',
      '--members-json', JSON.stringify([{ email: 'package.current@example.com', permission: 'admin' }]),
      '--postman-base-url', `${simulator.baseUrl}/package`
    ], {
      env: { POSTMAN_API_KEY: POSTMAN_KEY, POSTMAN_SCIM_API_KEY: SCIM_KEY }
    });
    assert.equal(result.code, 0, result.stderr);
    assertSecretsMasked(result);
    assert.deepEqual(JSON.parse(result.stdout).counts, {
      added: 1, invited: 0, pending: 0, skipped: 0, failed: 0
    });
  });

  process.stdout.write('Package e2e: packed CLI and packaged Sharooq installer both executed successfully.\n');
} finally {
  await simulator.close();
}
