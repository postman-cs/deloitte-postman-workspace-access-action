import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface ReusableWorkflow {
  on: {
    workflow_call: {
      inputs: Record<string, { default?: unknown; required?: boolean; type?: string }>;
      secrets: Record<string, { required?: boolean }>;
    };
  };
  jobs: {
    reconcile: {
      steps: Array<{ uses?: string; with?: Record<string, unknown> }>;
    };
  };
}

describe('Sharooq starter-kit contract', () => {
  const source = readFileSync('templates/deloitte-postman-workspace-access.yml', 'utf8');
  const workflow = parse(source) as ReusableWorkflow;

  it('defaults the reusable workflow to read-only preview', () => {
    expect(workflow.on.workflow_call.inputs.apply).toMatchObject({
      default: false,
      required: false,
      type: 'boolean'
    });
    const action = workflow.jobs.reconcile.steps.at(-1);
    expect(action?.uses).toBe('./.github/actions/deloitte-postman-workspace-access');
    expect(action?.with?.['dry-run']).toBe('${{ !inputs.apply }}');
  });

  it('requires both Postman credentials and supports scanner artifacts', () => {
    expect(workflow.on.workflow_call.secrets.POSTMAN_API_KEY?.required).toBe(true);
    expect(workflow.on.workflow_call.secrets.POSTMAN_SCIM_API_KEY?.required).toBe(true);
    expect(workflow.on.workflow_call.inputs['scanner-artifact']?.required).toBe(false);
    expect(workflow.jobs.reconcile.steps.some((step) => step.uses === 'actions/download-artifact@v8')).toBe(true);
  });

  it('documents pull-request preview and main-branch apply for Sharooq', () => {
    const runbook = readFileSync('docs/SHAROOQ-RUNBOOK.md', 'utf8');
    expect(runbook).toContain("github.event_name == 'push'");
    expect(runbook).toContain("github.ref == 'refs/heads/main'");
    expect(runbook).toContain('scripts/deloitte-postman-doctor.sh');
  });
});
