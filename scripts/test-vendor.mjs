import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const target = await mkdtemp(join(tmpdir(), 'deloitte-action-vendor-'));
try {
  const result = spawnSync('bash', ['scripts/vendor-action.sh', target], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  const installed = join(target, '.github/actions/deloitte-postman-workspace-access');
  await Promise.all([
    access(join(installed, 'action.yml')),
    access(join(installed, 'dist/index.cjs')),
    access(join(installed, 'LICENSE')),
    access(join(installed, 'README.md'))
  ]);

  const second = spawnSync('bash', ['scripts/vendor-action.sh', target], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(second.status, 73);
  assert.match(second.stderr, /already exists/);
  process.stdout.write('Vendor helper: self-contained install and overwrite protection passed.\n');
} finally {
  await rm(target, { recursive: true, force: true });
}
