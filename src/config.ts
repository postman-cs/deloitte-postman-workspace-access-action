import { access, readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';

import { parse as parseYaml } from 'yaml';

import type { InvalidMemberPolicy } from './contracts.js';

export interface DeloitteConfig {
  schemaVersion: 1;
  defaultWorkspaceRole?: string;
  roleMap?: Record<string, string>;
  postmanWorkspaceUrl?: string;
  sourceRepository?: string;
  scanner?: {
    searchRoot?: string;
    invalidMemberPolicy?: InvalidMemberPolicy;
    identityMapFile?: string;
    excludeBots?: boolean;
    excludeLogins?: string[];
  };
  notification?: {
    subject?: string;
    allowedDomains?: string[];
    gettingStartedUrl?: string;
    helpUrl?: string;
  };
}

export interface LoadedDeloitteConfig {
  path?: string;
  config: DeloitteConfig;
}

export const DEFAULT_CONFIG_FILE = '.deloitte-postman.yml';
export const DEFAULT_DELOITTE_CONFIG = `schemaVersion: 1
defaultWorkspaceRole: Viewer
postmanWorkspaceUrl: https://go.postman.co/

roleMap:
  admin: Admin
  maintain: Editor
  write: Editor
  push: Editor
  triage: Viewer
  read: Viewer
  pull: Viewer

scanner:
  searchRoot: artifacts
  invalidMemberPolicy: continue
  excludeBots: true
  excludeLogins: []
  # identityMapFile: .deloitte-postman/identity-map.json

notification:
  subject: "Deloitte: Your Postman workspace access"
  allowedDomains: []
  # gettingStartedUrl: https://learning.postman.com/
  # helpUrl: https://support.postman.com/

`;

function optionalString(value: unknown, field: string): string | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`${field} must be a string.`);
  const normalized = value.trim();
  return normalized || undefined;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'boolean') throw new Error(`${field} must be true or false.`);
  return value;
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${field} must be an array of strings.`);
  }
  return [...new Set(value.map((item) => item.trim().toLowerCase()).filter(Boolean))];
}

function optionalHttpsUrl(value: unknown, field: string): string | undefined {
  const candidate = optionalString(value, field);
  if (!candidate) return undefined;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`${field} must be a valid HTTPS URL.`);
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error(`${field} must be a credential-free HTTPS URL.`);
  }
  return url.toString();
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object.`);
  return value as Record<string, unknown>;
}

function roleMap(value: unknown): Record<string, string> | undefined {
  if (value == null) return undefined;
  const entries = record(value, 'roleMap');
  const result: Record<string, string> = {};
  for (const [permission, workspaceRole] of Object.entries(entries)) {
    const normalizedPermission = permission.trim().toLowerCase();
    const normalizedRole = optionalString(workspaceRole, `roleMap.${permission}`);
    if (!normalizedPermission || !normalizedRole) throw new Error('roleMap keys and values must be non-empty strings.');
    result[normalizedPermission] = normalizedRole;
  }
  return result;
}

export function parseDeloitteConfig(value: string): DeloitteConfig {
  let parsed: unknown;
  try {
    parsed = parseYaml(value);
  } catch (error) {
    throw new Error(`Deloitte config must be valid YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
  const root = record(parsed, 'Deloitte config');
  if (root.schemaVersion !== 1) throw new Error('Deloitte config schemaVersion must be 1.');
  const scanner = record(root.scanner, 'scanner');
  const notification = record(root.notification, 'notification');
  const invalidMemberPolicy = optionalString(scanner.invalidMemberPolicy, 'scanner.invalidMemberPolicy');
  if (invalidMemberPolicy && invalidMemberPolicy !== 'continue' && invalidMemberPolicy !== 'fail') {
    throw new Error('scanner.invalidMemberPolicy must be continue or fail.');
  }
  const defaultWorkspaceRole = optionalString(root.defaultWorkspaceRole, 'defaultWorkspaceRole');
  const configuredRoleMap = roleMap(root.roleMap);
  const postmanWorkspaceUrl = optionalHttpsUrl(root.postmanWorkspaceUrl, 'postmanWorkspaceUrl');
  const sourceRepository = optionalString(root.sourceRepository, 'sourceRepository');
  const scannerSearchRoot = optionalString(scanner.searchRoot, 'scanner.searchRoot');
  const identityMapFile = optionalString(scanner.identityMapFile, 'scanner.identityMapFile');
  const excludeBots = optionalBoolean(scanner.excludeBots, 'scanner.excludeBots');
  const excludeLogins = optionalStringArray(scanner.excludeLogins, 'scanner.excludeLogins');
  const notificationSubject = optionalString(notification.subject, 'notification.subject');
  const allowedDomains = optionalStringArray(notification.allowedDomains, 'notification.allowedDomains');
  const gettingStartedUrl = optionalHttpsUrl(notification.gettingStartedUrl, 'notification.gettingStartedUrl');
  const helpUrl = optionalHttpsUrl(notification.helpUrl, 'notification.helpUrl');
  const config: DeloitteConfig = {
    schemaVersion: 1,
    ...(defaultWorkspaceRole ? { defaultWorkspaceRole } : {}),
    ...(configuredRoleMap ? { roleMap: configuredRoleMap } : {}),
    ...(postmanWorkspaceUrl ? { postmanWorkspaceUrl } : {}),
    ...(sourceRepository ? { sourceRepository } : {}),
    scanner: {
      ...(scannerSearchRoot ? { searchRoot: scannerSearchRoot } : {}),
      ...(invalidMemberPolicy ? { invalidMemberPolicy: invalidMemberPolicy as InvalidMemberPolicy } : {}),
      ...(identityMapFile ? { identityMapFile } : {}),
      ...(excludeBots != null ? { excludeBots } : {}),
      ...(excludeLogins ? { excludeLogins } : {})
    },
    notification: {
      ...(notificationSubject ? { subject: notificationSubject } : {}),
      ...(allowedDomains ? { allowedDomains } : {}),
      ...(gettingStartedUrl ? { gettingStartedUrl } : {}),
      ...(helpUrl ? { helpUrl } : {})
    }
  };
  return config;
}

export async function loadDeloitteConfig(
  path: string | undefined,
  options: { required?: boolean } = {}
): Promise<LoadedDeloitteConfig> {
  if (!path?.trim()) return { config: { schemaVersion: 1 } };
  const resolvedPath = resolve(path);
  try {
    await access(resolvedPath);
  } catch {
    if (options.required) throw new Error(`Deloitte config was not found at ${resolvedPath}.`);
    return { config: { schemaVersion: 1 } };
  }
  return { path: resolvedPath, config: parseDeloitteConfig(await readFile(resolvedPath, 'utf8')) };
}

export function pathFromConfig(configPath: string | undefined, value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  return resolve(configPath ? dirname(configPath) : process.cwd(), value);
}

export async function loadIdentityMap(path: string | undefined): Promise<Record<string, string>> {
  if (!path) return {};
  const text = await readFile(path, 'utf8');
  if (extname(path).toLowerCase() === '.csv') {
    const result: Record<string, string> = {};
    for (const [index, line] of text.split(/\r?\n/u).entries()) {
      if (!line.trim()) continue;
      const [login, email] = line.split(',', 2).map((part) => part?.trim());
      if (index === 0 && login?.toLowerCase() === 'login' && email?.toLowerCase() === 'email') continue;
      if (!login || !email) throw new Error(`Invalid identity-map CSV row ${index + 1}.`);
      result[login.toLowerCase()] = email.toLowerCase();
    }
    return result;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Identity map must be JSON or CSV: ${error instanceof Error ? error.message : String(error)}`);
  }
  const values = record(parsed, 'Identity map');
  const result: Record<string, string> = {};
  for (const [login, email] of Object.entries(values)) {
    if (typeof email !== 'string' || !email.trim()) throw new Error(`Identity map entry ${login} must be an email string.`);
    result[login.trim().toLowerCase()] = email.trim().toLowerCase();
  }
  return result;
}
