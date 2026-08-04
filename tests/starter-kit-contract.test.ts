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
    const action = workflow.jobs.reconcile.steps.find(
      (step) => step.uses === './.github/actions/deloitte-postman-workspace-access'
    );
    expect(action?.uses).toBe('./.github/actions/deloitte-postman-workspace-access');
    expect(action?.with?.['dry-run']).toBe('${{ !inputs.apply }}');
  });

  it('requires both Postman credentials and supports scanner artifacts', () => {
    expect(workflow.on.workflow_call.secrets.POSTMAN_API_KEY?.required).toBe(true);
    expect(workflow.on.workflow_call.secrets.POSTMAN_SCIM_API_KEY?.required).toBe(true);
    expect(workflow.on.workflow_call.inputs['scanner-artifact']?.required).toBe(false);
    expect(workflow.on.workflow_call.inputs['default-workspace-role']?.default).toBe('');
    expect(workflow.on.workflow_call.secrets.DELOITTE_NOTIFICATION_WEBHOOK_URL?.required).toBe(false);
    expect(workflow.on.workflow_call.secrets.DELOITTE_NOTIFICATION_WEBHOOK_TOKEN?.required).toBe(false);
    expect(workflow.jobs.reconcile.steps.some(
      (step) => step.uses === 'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c'
    )).toBe(true);
  });

  it('renders and routes Deloitte onboarding notifications', () => {
    const action = workflow.jobs.reconcile.steps.find(
      (step) => step.uses === './.github/actions/deloitte-postman-workspace-access'
    );
    expect(action?.with?.['notification-webhook-url']).toBe('${{ secrets.DELOITTE_NOTIFICATION_WEBHOOK_URL }}');
    expect(action?.with?.['notifications-file']).toBe('.deloitte-postman/notifications.json');
    expect(source).toContain('notification-delivered-count');
  });

  it('centralizes onboarding policy and ships pending reconciliation', () => {
    expect(workflow.on.workflow_call.inputs['config-file']?.default).toBe('.deloitte-postman.yml');
    expect(workflow.on.workflow_call.inputs['scanner-search-root']?.default).toBe('');
    const pending = readFileSync('templates/deloitte-postman-pending-reconcile.yml', 'utf8');
    expect(pending).toContain('schedule:');
    expect(pending).toContain("DELOITTE_PENDING_RECONCILIATION_ENABLED == 'true'");
    expect(pending).toContain('Download latest successful scanner artifact');
    expect(pending).not.toContain('notification-webhook-url');
    expect(readFileSync('templates/logic-app/deloitte-postman-notifier.workflow.json', 'utf8'))
      .toContain('Deloitte_Postman_notification_batch');
  });

  it('documents pull-request preview and main-branch apply for Sharooq', () => {
    const runbook = readFileSync('docs/SHAROOQ-RUNBOOK.md', 'utf8');
    expect(runbook).toContain("github.event_name == 'push'");
    expect(runbook).toContain("github.ref == 'refs/heads/main'");
    expect(runbook).toContain('scripts/deloitte-postman-doctor.sh');
  });
});
