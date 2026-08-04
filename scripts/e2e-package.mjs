import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
    assert.equal(installedPackage.version, '0.1.1');
    assert.equal(installedPackage.bin['postman-workspace-access'], 'dist/cli.cjs');
    await readFile(join(packageRoot, 'node_modules/@postman-cse/deloitte-workspace-access/action.yml'));
    await readFile(join(packageRoot, 'node_modules/@postman-cse/deloitte-workspace-access/QUICKSTART.md'));
    await readFile(join(packageRoot, 'node_modules/@postman-cse/deloitte-workspace-access/schemas/deloitte-github-scanner-output.schema.json'));

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

  process.stdout.write('Package e2e: packed artifact installed and its published CLI reconciled a workspace successfully.\n');
} finally {
  await simulator.close();
}
