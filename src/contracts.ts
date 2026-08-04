import type { NormalizedMember, ScannerMember } from './types.js';

export const DEFAULT_ROLE_MAP: Readonly<Record<string, string>> = {
  admin: 'Admin',
  maintain: 'Editor',
  write: 'Editor',
  push: 'Editor',
  triage: 'Viewer',
  read: 'Viewer',
  pull: 'Viewer'
};

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const normalized = optionalString(value);
    if (normalized) return normalized;
  }
  return undefined;
}

const GITHUB_PERMISSION_PRECEDENCE = [
  'admin',
  'maintain',
  'write',
  'push',
  'triage',
  'read',
  'pull'
] as const;

function permissionsFromObject(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const permissions = value as Record<string, unknown>;
  const enabled = new Set(Object.entries(permissions).flatMap(([key, allowed]) => {
    const normalized = key.trim().toLowerCase();
    return allowed === true && normalized ? [normalized] : [];
  }));
  return [
    ...GITHUB_PERMISSION_PRECEDENCE.filter((permission) => enabled.delete(permission)),
    ...[...enabled].sort()
  ];
}

function permissionCandidates(member: ScannerMember): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of [
    member.githubPermission,
    member.github_permission,
    member.permission,
    member.roleName,
    member.role_name,
    member.role,
    ...permissionsFromObject(member.permissions)
  ]) {
    const permission = optionalString(value)?.toLowerCase();
    if (permission && !seen.has(permission)) {
      result.push(permission);
      seen.add(permission);
    }
  }
  return result;
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function roleRank(role: string): number {
  const normalized = role.toLowerCase();
  if (normalized === 'admin') return 3;
  if (normalized === 'editor') return 2;
  if (normalized === 'viewer') return 1;
  return 0;
}

export function parseRoleMap(value: string | undefined): Record<string, string> {
  if (!value?.trim()) return { ...DEFAULT_ROLE_MAP };
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`role-map-json must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('role-map-json must be a JSON object.');
  }
  const result: Record<string, string> = { ...DEFAULT_ROLE_MAP };
  for (const [key, target] of Object.entries(parsed)) {
    const normalizedKey = key.trim().toLowerCase();
    const normalizedTarget = optionalString(target);
    if (!normalizedKey || !normalizedTarget) {
      throw new Error('role-map-json keys and values must be non-empty strings.');
    }
    result[normalizedKey] = normalizedTarget;
  }
  return result;
}

function unwrapMembers(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.members)) return record.members;
    if (Array.isArray(record.collaborators)) return record.collaborators;
  }
  throw new Error('Members input must be an array or an object with a members/collaborators array.');
}

export function parseMembersJson(value: string, roleMap: Record<string, string>): NormalizedMember[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`Members input must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  const deduplicated = new Map<string, NormalizedMember>();
  for (const [index, raw] of unwrapMembers(parsed).entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`Member at index ${index} must be a JSON object.`);
    }
    const member = raw as ScannerMember;
    const email = firstString(member.email)?.toLowerCase();
    if (!email || !isEmail(email)) {
      throw new Error(`Member at index ${index} must include a valid email address.`);
    }

    const explicitRole = firstString(
      member.postmanRole,
      member.postman_role,
      member.workspaceRole,
      member.workspace_role
    );
    const candidates = permissionCandidates(member);
    const permission = candidates.find((candidate) => roleMap[candidate]);
    const workspaceRole = explicitRole ?? (permission ? roleMap[permission] : undefined);
    if (!workspaceRole) {
      throw new Error(
        `Member ${email} has no Postman workspace role and its GitHub permission is not present in role-map-json.`
      );
    }

    const githubLogin = optionalString(member.login);
    const scimId = firstString(member.scimId, member.scim_id);
    const externalId = firstString(member.externalId, member.external_id, member.login);
    const givenName = firstString(member.givenName, member.given_name);
    const familyName = firstString(member.familyName, member.family_name);
    const displayName = firstString(member.displayName, member.display_name);
    const normalized: NormalizedMember = {
      email,
      workspaceRole,
      ...(githubLogin ? { githubLogin } : {}),
      ...(permission ? { githubPermission: permission } : {}),
      ...(scimId ? { scimId } : {}),
      ...(externalId ? { externalId } : {}),
      ...(givenName ? { givenName } : {}),
      ...(familyName ? { familyName } : {}),
      ...(displayName ? { displayName } : {})
    };

    const previous = deduplicated.get(email);
    if (previous?.scimId && normalized.scimId && previous.scimId !== normalized.scimId) {
      throw new Error(`Duplicate member ${email} has conflicting SCIM IDs.`);
    }
    if (!previous) {
      deduplicated.set(email, normalized);
      continue;
    }
    const preferred = roleRank(normalized.workspaceRole) > roleRank(previous.workspaceRole)
      ? normalized
      : previous;
    deduplicated.set(email, {
      ...previous,
      ...normalized,
      workspaceRole: preferred.workspaceRole,
      ...(previous.scimId || normalized.scimId ? { scimId: previous.scimId ?? normalized.scimId } : {})
    });
  }
  return [...deduplicated.values()];
}

export function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (value == null || value.trim() === '') return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error(`Expected true or false, received ${value}.`);
}
