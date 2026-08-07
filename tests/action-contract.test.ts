import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface ActionContract {
  name?: string;
  inputs?: Record<string, { required?: boolean; default?: string }>;
  outputs?: Record<string, unknown>;
  runs?: { using?: string; main?: string };
}

describe('GitHub Action contract', () => {
  const action = parse(readFileSync('action.yml', 'utf8')) as ActionContract;

  it('is Deloitte-named and runs the committed Node 24 bundle', () => {
    expect(action.name).toContain('Deloitte');
    expect(action.runs).toEqual({ using: 'node24', main: 'dist/index.cjs' });
  });

  it('requires the target workspace and Postman API key', () => {
    expect(action.inputs?.['workspace-id']?.required).toBe(true);
    expect(action.inputs?.['postman-api-key']?.required).toBe(true);
    expect(action.inputs?.['postman-access-token']?.required).toBe(false);
    expect(action.inputs?.['postman-scim-api-key']?.required).toBe(false);
  });

  it('ships stable scanner inputs and reconciliation outputs', () => {
    expect(Object.keys(action.inputs ?? {})).toEqual(expect.arrayContaining([
      'members-json',
      'members-file',
      'config-file',
      'scanner-search-root',
      'identity-map-file',
      'invalid-member-policy',
      'exclude-bots',
      'exclude-logins-json',
      'role-map-json',
      'default-workspace-role',
      'summary-file',
      'notifications-file',
      'notification-webhook-url',
      'notification-webhook-token',
      'postman-workspace-url',
      'dry-run',
      'fail-on-pending-invites'
    ]));
    expect(Object.keys(action.outputs ?? {})).toEqual(expect.arrayContaining([
      'summary-json',
      'added-count',
      'invited-count',
      'pending-count',
      'failed-count',
      'detected-count',
      'resolved-count',
      'unresolved-count',
      'excluded-count',
      'unresolved-json',
      'scanner-source',
      'config-source',
      'summary-file',
      'notification-count',
      'notification-eligible-count',
      'notification-delivered-count',
      'notifications-file',
      'metrics-json'
    ]));
    expect(action.inputs?.['role-map-json']?.default).toBeUndefined();
    expect(action.inputs?.['default-workspace-role']?.default).toBeUndefined();
  });
});
