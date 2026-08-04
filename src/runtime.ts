import { readFile } from 'node:fs/promises';

import { parseMembersJson, parseRoleMap } from './contracts.js';
import type { NormalizedMember } from './types.js';

export async function loadMembers(
  membersJson: string | undefined,
  membersFile: string | undefined,
  roleMapJson: string | undefined
): Promise<NormalizedMember[]> {
  const inline = membersJson?.trim();
  const path = membersFile?.trim();
  if (inline && path) throw new Error('Provide only one of members-json or members-file.');
  if (!inline && !path) throw new Error('Provide members-json or members-file.');
  const source = inline ?? await readFile(path as string, 'utf8');
  return parseMembersJson(source, parseRoleMap(roleMapJson));
}

export function formatSummary(summary: unknown): string {
  return JSON.stringify(summary, null, 2);
}
