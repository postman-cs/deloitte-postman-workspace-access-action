import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const WORKFLOW_FILES = [
  '.github/workflows/ci.yml',
  '.github/workflows/release.yml',
  '.github/workflows/sandbox-smoke.yml',
  'templates/deloitte-postman-workspace-access.yml',
  'templates/deloitte-postman-pending-reconcile.yml'
];

describe('repository governance and supply chain', () => {
  it('pins every external workflow action to a full commit SHA', () => {
    for (const path of WORKFLOW_FILES) {
      const source = readFileSync(path, 'utf8');
      for (const match of source.matchAll(/uses:\s+([^\s#]+)/g)) {
        const action = match[1] as string;
        if (action.startsWith('./')) continue;
        expect(action, `${path}: ${action}`).toMatch(/^[^@]+@[a-f0-9]{40}$/);
      }
    }
  });

  it('keeps the live smoke test manual, sandbox-scoped, and explicitly confirmed', () => {
    const source = readFileSync('.github/workflows/sandbox-smoke.yml', 'utf8');
    const workflow = parse(source);
    expect(workflow.on.workflow_dispatch).toBeTruthy();
    expect(workflow.on.push).toBeUndefined();
    expect(workflow.on.schedule).toBeUndefined();
    expect(workflow.jobs.smoke.environment).toBe('postman-sandbox');
    expect(source).toContain('INVITE_DISPOSABLE_USER');
    expect(source).toContain('POSTMAN_SANDBOX_API_KEY');
    expect(source).toContain('POSTMAN_SANDBOX_SCIM_API_KEY');
  });

  it('ships release evidence and repository ownership controls', () => {
    const release = readFileSync('.github/workflows/release.yml', 'utf8');
    expect(release).toContain('actions/attest-build-provenance@');
    expect(release).toContain('npm run release:assets');
    expect(readFileSync('.github/CODEOWNERS', 'utf8')).toContain('@danielshively-source');
    expect(parse(readFileSync('.github/dependabot.yml', 'utf8')).updates).toHaveLength(2);
    expect(readFileSync('SECURITY.md', 'utf8')).toContain('security@postman.com');
  });
});
