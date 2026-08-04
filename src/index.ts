import * as core from '@actions/core';

import { parseBoolean } from './contracts.js';
import { PostmanClient } from './postman-client.js';
import { reconcileWorkspaceAccess } from './reconcile.js';
import { formatSummary, loadMembers } from './runtime.js';

function optionalInput(name: string): string | undefined {
  const value = core.getInput(name).trim();
  return value || undefined;
}

export async function runAction(): Promise<void> {
  try {
    const workspaceId = core.getInput('workspace-id', { required: true }).trim();
    const postmanApiKey = core.getInput('postman-api-key', { required: true }).trim();
    const scimApiKey = optionalInput('postman-scim-api-key');
    core.setSecret(postmanApiKey);
    if (scimApiKey) core.setSecret(scimApiKey);

    const members = await loadMembers(
      optionalInput('members-json'),
      optionalInput('members-file'),
      optionalInput('role-map-json')
    );
    const dryRun = parseBoolean(optionalInput('dry-run'));
    const failOnPending = parseBoolean(optionalInput('fail-on-pending-invites'));
    const baseUrl = optionalInput('postman-base-url');
    const client = new PostmanClient({
      postmanApiKey,
      ...(scimApiKey ? { scimApiKey } : {}),
      ...(baseUrl ? { baseUrl } : {})
    });

    const summary = await reconcileWorkspaceAccess(client, {
      workspaceId,
      members,
      dryRun
    }, {
      info: (message) => core.info(message),
      warning: (message) => core.warning(message)
    });

    core.setOutput('summary-json', JSON.stringify(summary));
    core.setOutput('added-count', String(summary.counts.added));
    core.setOutput('invited-count', String(summary.counts.invited));
    core.setOutput('pending-count', String(summary.counts.pending));
    core.setOutput('skipped-count', String(summary.counts.skipped));
    core.setOutput('failed-count', String(summary.counts.failed));
    await core.summary
      .addHeading('Postman workspace access')
      .addCodeBlock(formatSummary(summary), 'json')
      .write();

    if (summary.counts.failed > 0) {
      throw new Error(`${summary.counts.failed} workspace access operation(s) failed.`);
    }
    if (failOnPending && summary.counts.pending > 0) {
      throw new Error(`${summary.counts.pending} invited user(s) are pending before workspace access can be assigned.`);
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

if (process.env.NODE_ENV !== 'test') {
  void runAction();
}
