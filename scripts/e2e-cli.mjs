import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

const POSTMAN_KEY = 'qa-postman-key-never-log';
const SCIM_KEY = 'qa-scim-key-never-log';

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function send(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function runCli(baseUrl, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      'dist/cli.cjs',
      '--workspace-id',
      'workspace-e2e',
      '--members-file',
      'fixtures/e2e-members.json',
      '--postman-base-url',
      baseUrl,
      ...extraArgs
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        POSTMAN_API_KEY: POSTMAN_KEY,
        POSTMAN_SCIM_API_KEY: SCIM_KEY
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const requests = [];
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const body = await readBody(request);
  requests.push({
    method: request.method,
    path: url.pathname,
    query: url.searchParams.toString(),
    body,
    postmanKey: request.headers['x-api-key'],
    scimKey: request.headers.authorization,
    identifierType: request.headers.identifiertype
  });

  if (request.method === 'GET' && url.pathname === '/workspace-roles') {
    return send(response, 200, { roles: [
      { id: '1', displayName: 'Viewer' },
      { id: '2', displayName: 'Editor' },
      { id: '3', displayName: 'Admin' }
    ] });
  }
  if (request.method === 'GET' && url.pathname === '/scim/v2/Users') {
    const filter = url.searchParams.get('filter') ?? '';
    return send(response, 200, filter.includes('existing.owner@example.com')
      ? { Resources: [{ id: 'scim-existing', userName: 'existing.owner@example.com', active: true }] }
      : { Resources: [] });
  }
  if (request.method === 'POST' && url.pathname === '/scim/v2/Users') {
    const parsed = JSON.parse(body);
    assert.equal(parsed.userName, 'new.developer@example.com');
    return send(response, 201, { id: 'scim-new', userName: parsed.userName, active: true });
  }
  if (request.method === 'PATCH' && url.pathname === '/workspaces/workspace-e2e/roles') {
    return send(response, 200, { roles: [] });
  }
  return send(response, 404, { error: 'unexpected route' });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address === 'object');
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const live = await runCli(baseUrl);
  assert.equal(live.code, 0, live.stderr);
  const liveSummary = JSON.parse(live.stdout);
  assert.deepEqual(liveSummary.counts, {
    added: 2,
    invited: 1,
    pending: 0,
    skipped: 0,
    failed: 0
  });
  assert(!live.stdout.includes(POSTMAN_KEY));
  assert(!live.stdout.includes(SCIM_KEY));
  assert(!live.stderr.includes(POSTMAN_KEY));
  assert(!live.stderr.includes(SCIM_KEY));

  const rolePatch = requests.find((entry) =>
    entry.method === 'PATCH' && entry.path === '/workspaces/workspace-e2e/roles'
  );
  assert(rolePatch);
  assert.equal(rolePatch.identifierType, 'scim');
  assert.equal(rolePatch.postmanKey, POSTMAN_KEY);
  const assignments = JSON.parse(rolePatch.body).roles[0].value;
  assert.deepEqual(assignments, [
    { id: 'scim-existing', role: '3' },
    { id: 'scim-new', role: '2' }
  ]);

  requests.length = 0;
  const dryRun = await runCli(baseUrl, ['--dry-run']);
  assert.equal(dryRun.code, 0, dryRun.stderr);
  assert.equal(JSON.parse(dryRun.stdout).counts.skipped, 2);
  assert.equal(requests.some((entry) => entry.method === 'POST'), false);
  assert.equal(requests.some((entry) => entry.method === 'PATCH'), false);

  process.stdout.write('CLI e2e: live reconciliation, dry-run safety, role mapping, and secret redaction passed.\n');
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
