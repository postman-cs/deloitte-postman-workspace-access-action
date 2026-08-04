import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_DELOITTE_CONFIG,
  loadDeloitteConfig,
  loadIdentityMap,
  parseDeloitteConfig,
  pathFromConfig
} from '../src/config.js';

describe('Deloitte configuration', () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it('parses the installed zero-touch defaults', () => {
    expect(parseDeloitteConfig(DEFAULT_DELOITTE_CONFIG)).toMatchObject({
      schemaVersion: 1,
      defaultWorkspaceRole: 'Viewer',
      roleMap: { admin: 'Admin', write: 'Editor', read: 'Viewer' },
      scanner: { invalidMemberPolicy: 'continue', excludeBots: true }
    });
  });

  it('loads relative identity maps from JSON and CSV', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'deloitte-config-'));
    directories.push(directory);
    const configPath = join(directory, '.deloitte-postman.yml');
    const identityPath = join(directory, 'identity.csv');
    await writeFile(configPath, 'schemaVersion: 1\nscanner:\n  identityMapFile: identity.csv\n');
    await writeFile(identityPath, 'login,email\nSharooq,Sharooq@deloitte.com\n');
    const loaded = await loadDeloitteConfig(configPath, { required: true });
    const resolvedIdentityPath = pathFromConfig(loaded.path, loaded.config.scanner?.identityMapFile);

    expect(resolvedIdentityPath).toBe(identityPath);
    await expect(loadIdentityMap(resolvedIdentityPath)).resolves.toEqual({ sharooq: 'sharooq@deloitte.com' });
  });

  it('rejects unsafe links and unsupported schemas', () => {
    expect(() => parseDeloitteConfig('schemaVersion: 2')).toThrow(/schemaVersion must be 1/);
    expect(() => parseDeloitteConfig('schemaVersion: 1\npostmanWorkspaceUrl: http://example.com')).toThrow(/HTTPS URL/);
  });
});
