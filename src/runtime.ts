import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import { parseMembersJson, parseRoleMap } from './contracts.js';
import type { NormalizedMember } from './types.js';

const SCANNER_FILENAMES = new Set([
  'deloitte-github-scanner-output.json',
  'github-scanner-output.json',
  'scanner-output.json'
]);
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules']);

export interface ResolvedMembersInput {
  members: NormalizedMember[];
  source: string;
  discovered: boolean;
}

async function findScannerFiles(directory: string, results: string[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) {
      await findScannerFiles(path, results);
    } else if (entry.isFile() && SCANNER_FILENAMES.has(entry.name.toLowerCase())) {
      results.push(path);
    }
  }
}

export async function discoverMembersFile(searchRoot = process.cwd()): Promise<string> {
  const root = resolve(searchRoot);
  const matches: string[] = [];
  try {
    await findScannerFiles(root, matches);
  } catch (error) {
    throw new Error(
      `Unable to search scanner root ${root}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (matches.length === 0) {
    throw new Error(
      `No scanner output was found under ${root}. Expected one file named ${[...SCANNER_FILENAMES].join(', ')}.`
    );
  }
  if (matches.length > 1) {
    const candidates = matches.map((path) => relative(root, path) || path).join(', ');
    throw new Error(`Multiple scanner outputs were found under ${root}: ${candidates}. Set members-file explicitly.`);
  }
  return matches[0] as string;
}

export async function resolveMembersInput(
  membersJson: string | undefined,
  membersFile: string | undefined,
  roleMapJson: string | undefined,
  scannerSearchRoot?: string
): Promise<ResolvedMembersInput> {
  const inline = membersJson?.trim();
  const explicitPath = membersFile?.trim();
  if (inline && explicitPath) throw new Error('Provide only one of members-json or members-file.');
  const discovered = !inline && !explicitPath;
  const path = explicitPath ?? (discovered ? await discoverMembersFile(scannerSearchRoot) : undefined);
  const source = inline ?? await readFile(path as string, 'utf8');
  return {
    members: parseMembersJson(source, parseRoleMap(roleMapJson)),
    source: inline ? 'inline JSON' : resolve(path as string),
    discovered
  };
}

export function formatSummary(summary: unknown): string {
  return JSON.stringify(summary, null, 2);
}
