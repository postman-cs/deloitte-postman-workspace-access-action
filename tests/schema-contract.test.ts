import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

interface ScannerSchema {
  $defs: {
    member: {
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

describe('Deloitte scanner JSON schema', () => {
  const schema = JSON.parse(
    readFileSync('schemas/deloitte-github-scanner-output.schema.json', 'utf8')
  ) as ScannerSchema;
  const member = schema.$defs.member;

  it('documents every accepted scanner alias', () => {
    expect(Object.keys(member.properties)).toEqual(expect.arrayContaining([
      'externalId',
      'external_id',
      'scimId',
      'scim_id',
      'givenName',
      'given_name',
      'familyName',
      'family_name',
      'displayName',
      'display_name',
      'githubPermission',
      'github_permission',
      'roleName',
      'role_name',
      'workspaceRole',
      'workspace_role',
      'postmanRole',
      'postman_role'
    ]));
  });

  it('requires only the corporate email needed for inclusive onboarding', () => {
    expect(member.required).toEqual(['email']);
  });
});
