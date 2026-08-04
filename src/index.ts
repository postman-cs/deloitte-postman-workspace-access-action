import * as core from '@actions/core';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { parseBoolean } from './contracts.js';
import {
  buildNotificationEnvelope,
  deliverNotificationEnvelope,
  validateNotificationConfiguration,
  writeNotificationEnvelope
} from './notifications.js';
import { PostmanClient } from './postman-client.js';
import { reconcileWorkspaceAccess } from './reconcile.js';
import { formatMarkdownSummary, formatSummary, resolveMembersInput } from './runtime.js';

function optionalInput(name: string): string | undefined {
  const value = core.getInput(name).trim();
  return value || undefined;
}

export async function runAction(): Promise<void> {
  try {
    const workspaceId = core.getInput('workspace-id', { required: true }).trim();
    const postmanApiKey = core.getInput('postman-api-key', { required: true }).trim();
    const scimApiKey = optionalInput('postman-scim-api-key');
    const notificationWebhookUrl = optionalInput('notification-webhook-url');
    const notificationWebhookToken = optionalInput('notification-webhook-token');
    const workspaceUrl = optionalInput('postman-workspace-url');
    const notificationSubject = optionalInput('notification-subject');
    core.setSecret(postmanApiKey);
    if (scimApiKey) core.setSecret(scimApiKey);
    if (notificationWebhookUrl) core.setSecret(notificationWebhookUrl);
    if (notificationWebhookToken) core.setSecret(notificationWebhookToken);
    validateNotificationConfiguration({
      ...(workspaceUrl ? { workspaceUrl } : {}),
      ...(notificationSubject ? { subject: notificationSubject } : {})
    }, notificationWebhookUrl);

    const resolved = await resolveMembersInput(
      optionalInput('members-json'),
      optionalInput('members-file'),
      optionalInput('role-map-json'),
      optionalInput('scanner-search-root'),
      optionalInput('default-workspace-role') ?? 'Viewer'
    );
    if (resolved.discovered) core.info(`Auto-discovered scanner output at ${resolved.source}.`);
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
      members: resolved.members,
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
    core.setOutput('scanner-source', resolved.source);
    const summaryFile = optionalInput('summary-file');
    if (summaryFile) {
      const summaryPath = resolve(summaryFile);
      await mkdir(dirname(summaryPath), { recursive: true });
      await writeFile(summaryPath, `${formatSummary(summary)}\n`, { mode: 0o600 });
      core.setOutput('summary-file', summaryPath);
    }
    await core.summary.addRaw(formatMarkdownSummary(summary)).write();

    const sourceRepository = optionalInput('source-repository') ?? process.env.GITHUB_REPOSITORY;
    const notificationEnvelope = buildNotificationEnvelope(summary, {
      ...(workspaceUrl ? { workspaceUrl } : {}),
      ...(sourceRepository ? { sourceRepository } : {}),
      ...(notificationSubject ? { subject: notificationSubject } : {})
    });
    const notificationCount = notificationEnvelope.notifications.length;
    const eligibleNotificationCount = notificationEnvelope.notifications.filter(({ send }) => send).length;
    core.setOutput('notification-count', String(notificationCount));
    core.setOutput('notification-eligible-count', String(eligibleNotificationCount));
    core.setOutput('notification-delivered-count', '0');
    const notificationsFile = optionalInput('notifications-file');
    if (notificationsFile) {
      const notificationsPath = await writeNotificationEnvelope(notificationsFile, notificationEnvelope);
      core.setOutput('notifications-file', notificationsPath);
    }
    if (notificationWebhookUrl) {
      const runId = process.env.GITHUB_RUN_ID?.trim();
      const runAttempt = process.env.GITHUB_RUN_ATTEMPT?.trim() || '1';
      const delivered = await deliverNotificationEnvelope(notificationEnvelope, {
        webhookUrl: notificationWebhookUrl,
        ...(notificationWebhookToken ? { token: notificationWebhookToken } : {}),
        ...(runId ? { idempotencyKey: `deloitte-postman:${workspaceId}:${runId}:${runAttempt}` } : {})
      });
      core.setOutput('notification-delivered-count', String(delivered));
      core.info(`Deloitte notification gateway accepted ${delivered} onboarding notification(s).`);
    } else if (!dryRun && notificationCount > 0) {
      core.info('Onboarding notifications were generated but not delivered because notification-webhook-url is not configured.');
    }

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
