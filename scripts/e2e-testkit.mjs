import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const POSTMAN_KEY = 'qa-postman-key-never-log';
export const SCIM_KEY = 'qa-scim-key-never-log';
export const NOTIFICATION_TOKEN = 'qa-notification-token-never-log';

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(JSON.stringify(body));
}

function initialUsers() {
  return new Map([
    ['existing.admin@example.com', { id: 'scim-existing-admin', userName: 'existing.admin@example.com', active: true }],
    ['inactive.editor@example.com', { id: 'scim-inactive-editor', userName: 'inactive.editor@example.com', active: false }],
    ['existing.good@example.com', { id: 'scim-existing-good', userName: 'existing.good@example.com', active: true }],
    ['existing.bad@example.com', { id: 'scim-existing-bad', userName: 'existing.bad@example.com', active: true }],
    ['action.current@example.com', { id: 'scim-action-current', userName: 'action.current@example.com', active: true }],
    ['vendor.current@example.com', { id: 'scim-vendor-current', userName: 'vendor.current@example.com', active: true }],
    ['package.current@example.com', { id: 'scim-package-current', userName: 'package.current@example.com', active: true }]
  ]);
}

function stateFor(states, scenario) {
  if (!states.has(scenario)) {
    states.set(scenario, {
      users: initialUsers(),
      roleCatalogAttempts: 0,
      workspacePatchAttempts: 0
    });
  }
  return states.get(scenario);
}

function scimEmail(url) {
  const filter = url.searchParams.get('filter') ?? '';
  const match = /userName eq "([^"]+)"/.exec(filter);
  return match?.[1]?.replaceAll('\\"', '"').toLowerCase();
}

export async function startSimulator() {
  const requests = [];
  const states = new Map();
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const [, scenario = 'default', ...pathParts] = url.pathname.split('/');
    const apiPath = `/${pathParts.join('/')}`;
    const body = await readBody(request);
    const parsedBody = body ? JSON.parse(body) : undefined;
    const entry = {
      scenario,
      method: request.method ?? 'GET',
      path: apiPath,
      query: url.searchParams.toString(),
      body: parsedBody,
      postmanKey: request.headers['x-api-key'],
      scimKey: request.headers.authorization,
      identifierType: request.headers.identifiertype,
      contentType: request.headers['content-type'],
      idempotencyKey: request.headers['idempotency-key']
    };
    requests.push(entry);
    const state = stateFor(states, scenario);

    if (request.method === 'POST' && scenario.startsWith('notification-') && apiPath === '/email-batches') {
      assert.equal(entry.scimKey, `Bearer ${NOTIFICATION_TOKEN}`);
      assert.equal(entry.contentType, 'application/json');
      assert.equal(parsedBody?.schemaVersion, 1);
      assert.equal(parsedBody?.kind, 'deloitte-postman-onboarding');
      assert(Array.isArray(parsedBody?.notifications));
      if (scenario === 'notification-rejected') {
        return sendJson(response, 400, { error: 'mail policy rejected batch' });
      }
      return sendJson(response, 202, { accepted: parsedBody.notifications.length });
    }

    if (request.method === 'GET' && apiPath === '/workspace-roles') {
      state.roleCatalogAttempts += 1;
      assert.equal(entry.postmanKey, POSTMAN_KEY);
      if (scenario === 'retry' && state.roleCatalogAttempts === 1) {
        return sendJson(response, 429, { error: 'rate limited once' }, { 'retry-after': '0' });
      }
      return sendJson(response, 200, { roles: [
        { id: '1', displayName: 'Viewer' },
        { id: '2', displayName: 'Editor' },
        { id: '3', displayName: 'Admin' }
      ] });
    }

    if (request.method === 'GET' && /^\/workspaces\/[^/]+$/.test(apiPath)) {
      assert.equal(entry.postmanKey, POSTMAN_KEY);
      const id = decodeURIComponent(apiPath.slice('/workspaces/'.length));
      return sendJson(response, 200, { workspace: { id, name: 'Deloitte QA Workspace' } });
    }

    if (request.method === 'GET' && apiPath === '/scim/v2/Users') {
      assert.equal(entry.scimKey, SCIM_KEY);
      const email = scimEmail(url);
      const user = email ? state.users.get(email) : undefined;
      return sendJson(response, 200, { Resources: user ? [user] : [] });
    }

    if (request.method === 'POST' && apiPath === '/scim/v2/Users') {
      assert.equal(entry.scimKey, SCIM_KEY);
      assert.equal(entry.contentType, 'application/json');
      assert.equal(parsedBody?.schemas?.[0], 'urn:ietf:params:scim:schemas:core:2.0:User');
      const email = String(parsedBody?.userName ?? '').toLowerCase();
      assert(email.includes('@'));
      if (email === 'race.user@example.com') {
        state.users.set(email, { id: 'scim-race-user', userName: email, active: true });
        return sendJson(response, 409, { error: 'created concurrently' });
      }
      const id = `scim-${email.split('@')[0].replaceAll('.', '-')}`;
      const user = { id, userName: email, active: true, externalId: parsedBody.externalId };
      state.users.set(email, user);
      return sendJson(response, 201, user);
    }

    if (request.method === 'PATCH' && apiPath.startsWith('/scim/v2/Users/')) {
      assert.equal(entry.scimKey, SCIM_KEY);
      const id = decodeURIComponent(apiPath.slice('/scim/v2/Users/'.length));
      const user = [...state.users.values()].find((candidate) => candidate.id === id);
      if (!user) return sendJson(response, 404, { error: 'user not found' });
      assert.deepEqual(parsedBody?.Operations, [{ op: 'replace', value: { active: true } }]);
      user.active = true;
      return sendJson(response, 200, user);
    }

    if (request.method === 'PATCH' && /^\/workspaces\/[^/]+\/roles$/.test(apiPath)) {
      assert.equal(entry.postmanKey, POSTMAN_KEY);
      assert.equal(entry.identifierType, 'scim');
      assert.equal(entry.contentType, 'application/json-patch+json');
      const assignments = parsedBody?.roles?.[0]?.value ?? [];
      assert(Array.isArray(assignments));
      state.workspacePatchAttempts += 1;

      if (scenario === 'pending') return sendJson(response, 422, { error: 'invite acceptance required' });
      if (scenario === 'partial') {
        if (assignments.length > 1) return sendJson(response, 500, { error: 'batch rejected' });
        const id = assignments[0]?.id;
        if (id === 'scim-new-pending') return sendJson(response, 422, { error: 'invite acceptance required' });
        if (id === 'scim-existing-bad') return sendJson(response, 403, { error: 'forbidden assignment' });
      }
      if (scenario === 'retry' && state.workspacePatchAttempts === 1) {
        return sendJson(response, 503, { error: 'transient workspace failure' });
      }
      return sendJson(response, 200, { roles: [] });
    }

    return sendJson(response, 404, { error: `unexpected ${request.method} ${apiPath}` });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    requestsFor: (scenario) => requests.filter((request) => request.scenario === scenario),
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

export function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

export async function withTempDir(prefix, callback) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readActionOutputs(path) {
  const text = await readFile(path, 'utf8');
  const outputs = {};
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^([^<]+)<<(.+)$/.exec(lines[index]);
    if (!match) continue;
    const [, name, delimiter] = match;
    const values = [];
    index += 1;
    while (index < lines.length && lines[index] !== delimiter) {
      values.push(lines[index]);
      index += 1;
    }
    outputs[name] = values.join('\n');
  }
  return outputs;
}

export function assertSecretsMasked(result, extraText = '') {
  const nonMaskStdout = result.stdout
    .split('\n')
    .filter((line) => !line.startsWith('::add-mask::'))
    .join('\n');
  for (const secret of [POSTMAN_KEY, SCIM_KEY, NOTIFICATION_TOKEN]) {
    assert(!nonMaskStdout.includes(secret), `stdout leaked ${secret}`);
    assert(!result.stderr.includes(secret), `stderr leaked ${secret}`);
    assert(!extraText.includes(secret), `output artifact leaked ${secret}`);
  }
}
