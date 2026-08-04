import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import { parseMembersReport, parseRoleMap } from './contracts.js';
import type { MemberParsingOptions } from './contracts.js';
import type {
  ExcludedScannerMember,
  NormalizedMember,
  ReconcileSummary,
  ScannerIssue,
  ValidationReport
} from './types.js';

const SCANNER_FILENAMES = new Set([
  'deloitte-github-scanner-output.json',
  'github-scanner-output.json',
  'scanner-output.json'
]);
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules']);

export interface ResolvedMembersInput {
  detected: number;
  members: NormalizedMember[];
  unresolved: ScannerIssue[];
  excluded: ExcludedScannerMember[];
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
  scannerSearchRoot?: string,
  defaultWorkspaceRole?: string,
  memberOptions: Omit<MemberParsingOptions, 'defaultWorkspaceRole'> = {}
): Promise<ResolvedMembersInput> {
  const inline = membersJson?.trim();
  const explicitPath = membersFile?.trim();
  if (inline && explicitPath) throw new Error('Provide only one of members-json or members-file.');
  const discovered = !inline && !explicitPath;
  const path = explicitPath ?? (discovered ? await discoverMembersFile(scannerSearchRoot) : undefined);
  const source = inline ?? await readFile(path as string, 'utf8');
  const report = parseMembersReport(source, parseRoleMap(roleMapJson), {
    ...(defaultWorkspaceRole ? { defaultWorkspaceRole } : {}),
    ...memberOptions
  });
  return {
    detected: report.detected,
    members: report.members,
    unresolved: report.unresolved,
    excluded: report.excluded,
    source: inline ? 'inline JSON' : resolve(path as string),
    discovered
  };
}

export function formatSummary(summary: unknown): string {
  return JSON.stringify(summary, null, 2);
}

export function buildValidationReport(
  members: NormalizedMember[],
  source: string,
  resolution: {
    detected?: number;
    unresolved?: ScannerIssue[];
    excluded?: ExcludedScannerMember[];
  } = {}
): ValidationReport {
  const workspaceRoles: Record<string, number> = {};
  for (const member of members) {
    workspaceRoles[member.workspaceRole] = (workspaceRoles[member.workspaceRole] ?? 0) + 1;
  }
  const withScimId = members.filter((member) => Boolean(member.scimId)).length;
  return {
    ok: true,
    scanner: {
      source,
      detected: resolution.detected ?? members.length,
      uniqueMembers: members.length,
      withScimId,
      requiringScimLookup: members.length - withScimId,
      unresolved: resolution.unresolved?.length ?? 0,
      excluded: resolution.excluded?.length ?? 0
    },
    workspaceRoles,
    members: members.map((member) => ({
      email: member.email,
      workspaceRole: member.workspaceRole,
      ...(member.githubPermission ? { githubPermission: member.githubPermission } : {}),
      ...(member.githubLogin ? { githubLogin: member.githubLogin } : {}),
      hasScimId: Boolean(member.scimId)
    })),
    unresolved: resolution.unresolved ?? [],
    excluded: resolution.excluded ?? []
  };
}

function markdownCell(value: unknown): string {
  return String(value ?? '')
    .replaceAll('|', '\\|')
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ');
}

function nextStep(result: ReconcileSummary['results'][number]): string {
  if (result.workspaceAccess === 'pending') return 'Accept the Postman team invitation, then rerun.';
  if (result.workspaceAccess === 'failed') return result.message ?? 'Review the operation error and rerun.';
  if (result.workspaceAccess === 'would-add') return result.message ?? 'Review this preview before applying.';
  return 'None.';
}

export function formatMarkdownSummary(summary: ReconcileSummary): string {
  const status = summary.counts.failed > 0
    ? '❌ Action required'
    : summary.counts.pending > 0
      ? '⚠️ Invitations pending'
      : summary.dryRun
        ? '🔎 Read-only preview'
        : '✅ Complete';
  const counts = [
    ['Added', summary.counts.added],
    ['Invited', summary.counts.invited],
    ['Pending', summary.counts.pending],
    [summary.dryRun ? 'Planned' : 'Skipped', summary.counts.skipped],
    ['Failed', summary.counts.failed]
  ];
  const lines = [
    '## Deloitte: Postman workspace access',
    '',
    `**${status}** — workspace \`${markdownCell(summary.workspaceId)}\``,
    '',
    '| Outcome | Count |',
    '| --- | ---: |',
    ...counts.map(([label, count]) => `| ${label} | ${count} |`),
    '',
    '### User results',
    '',
    '| User | Workspace role | Team lifecycle | Workspace access | Next step |',
    '| --- | --- | --- | --- | --- |',
    ...summary.results.map((result) => [
      markdownCell(result.email),
      markdownCell(result.workspaceRole),
      markdownCell(result.lifecycle),
      markdownCell(result.workspaceAccess),
      markdownCell(nextStep(result))
    ].join(' | ')).map((row) => `| ${row} |`),
    ''
  ];
  return lines.join('\n');
}
