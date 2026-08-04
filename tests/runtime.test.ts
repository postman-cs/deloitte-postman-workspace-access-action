import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { discoverMembersFile, resolveMembersInput } from '../src/runtime.js';

describe('scanner output discovery', () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  async function temporaryDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'deloitte-discovery-'));
    directories.push(directory);
    return directory;
  }

  it('finds and loads a uniquely named scanner file recursively', async () => {
    const root = await temporaryDirectory();
    const artifacts = join(root, 'artifacts', 'scanner');
    await mkdir(artifacts, { recursive: true });
    const scanner = join(artifacts, 'github-scanner-output.json');
    await writeFile(scanner, JSON.stringify({ collaborators: [
      { email: 'sharooq@example.com', permission: 'admin' }
    ] }));

    const resolved = await resolveMembersInput(undefined, undefined, undefined, root);

    expect(resolved).toMatchObject({ source: scanner, discovered: true });
    expect(resolved.members).toEqual([expect.objectContaining({
      email: 'sharooq@example.com',
      workspaceRole: 'Admin'
    })]);
  });

  it('refuses to guess when more than one scanner output exists', async () => {
    const root = await temporaryDirectory();
    await writeFile(join(root, 'scanner-output.json'), '[]');
    await writeFile(join(root, 'github-scanner-output.json'), '[]');

    await expect(discoverMembersFile(root)).rejects.toThrow(/Multiple scanner outputs/);
  });

  it('ignores scanner-like files under node_modules and .git', async () => {
    const root = await temporaryDirectory();
    await mkdir(join(root, 'node_modules', 'fixture'), { recursive: true });
    await mkdir(join(root, '.git', 'fixture'), { recursive: true });
    await writeFile(join(root, 'node_modules', 'fixture', 'scanner-output.json'), '[]');
    await writeFile(join(root, '.git', 'fixture', 'github-scanner-output.json'), '[]');

    await expect(discoverMembersFile(root)).rejects.toThrow(/No scanner output/);
  });
});
