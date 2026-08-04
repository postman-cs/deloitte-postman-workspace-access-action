import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { runProcess, withTempDir } from './e2e-testkit.mjs';

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const version = String(packageJson.version);
const tag = `v${version}`;

await withTempDir('deloitte-release-e2e-', async (directory) => {
  const verify = await runProcess(process.execPath, ['scripts/verify-release.mjs', tag]);
  assert.equal(verify.code, 0, verify.stderr);

  const mismatch = await runProcess(process.execPath, ['scripts/verify-release.mjs', 'v9.9.9']);
  assert.equal(mismatch.code, 1);
  assert.match(mismatch.stderr, /does not match package version/);

  const build = await runProcess(process.execPath, [
    'scripts/build-release-assets.mjs', '--output', directory
  ]);
  assert.equal(build.code, 0, build.stderr);

  const files = await readdir(directory);
  const starterKit = files.find(
    (file) => file === `deloitte-postman-workspace-access-starter-kit-${tag}.tar.gz`
  );
  const npmPackage = files.find((file) => file.endsWith(`-${version}.tgz`));
  const sbom = files.find((file) => file.endsWith(`-${tag}.cdx.json`));
  const manifest = files.find((file) => file.endsWith(`-${tag}.manifest.json`));
  assert(starterKit && npmPackage && sbom && manifest);
  assert(files.includes('README.md'));
  assert(files.includes('BUILD_LOG.md'));

  const sbomJson = JSON.parse(await readFile(join(directory, sbom), 'utf8'));
  assert.equal(sbomJson.bomFormat, 'CycloneDX');
  const manifestJson = JSON.parse(await readFile(join(directory, manifest), 'utf8'));
  assert.equal(manifestJson.version, version);
  assert.equal(manifestJson.readme, 'README.md');
  assert.equal(manifestJson.buildLog, 'BUILD_LOG.md');
  assert.match(await readFile(join(directory, 'BUILD_LOG.md'), 'utf8'), new RegExp(tag.replaceAll('.', '\\.'), 'u'));

  const checksumLines = (await readFile(join(directory, 'SHA256SUMS'), 'utf8')).trim().split('\n');
  assert.equal(checksumLines.length, 6);
  for (const line of checksumLines) {
    const [expected, file] = line.split(/\s{2}/);
    const actual = createHash('sha256').update(await readFile(join(directory, file))).digest('hex');
    assert.equal(actual, expected, `checksum mismatch for ${file}`);
  }

  const archive = await runProcess('tar', ['-tzf', join(directory, starterKit)]);
  assert.equal(archive.code, 0, archive.stderr);
  assert.match(archive.stdout, /scripts\/deloitte-init\.sh/);
  assert.match(archive.stdout, /README\.md/);
  assert.match(archive.stdout, /BUILD_LOG\.md/);
  assert.match(archive.stdout, /docs\/POSTMAN-PREREQUISITES\.md/);
  assert.match(archive.stdout, /templates\/deloitte-postman-workspace-access\.yml/);
});

process.stdout.write('Release e2e: README, build log, starter kit, package, SBOM, manifest, and checksums passed.\n');
