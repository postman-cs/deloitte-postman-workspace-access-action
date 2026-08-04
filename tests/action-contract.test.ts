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
    expect(action.inputs?.['postman-scim-api-key']?.required).toBe(false);
  });

  it('ships stable scanner inputs and reconciliation outputs', () => {
    expect(Object.keys(action.inputs ?? {})).toEqual(expect.arrayContaining([
      'members-json',
      'members-file',
      'scanner-search-root',
      'role-map-json',
      'dry-run',
      'fail-on-pending-invites'
    ]));
    expect(Object.keys(action.outputs ?? {})).toEqual(expect.arrayContaining([
      'summary-json',
      'added-count',
      'invited-count',
      'pending-count',
      'failed-count',
      'scanner-source'
    ]));
    expect(() => JSON.parse(action.inputs?.['role-map-json']?.default ?? '')).not.toThrow();
  });
});
