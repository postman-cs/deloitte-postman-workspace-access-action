import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  buildNotificationEnvelope,
  deliverNotificationEnvelope,
  writeNotificationEnvelope
} from '../src/notifications.js';
import type { FetchLike, ReconcileSummary } from '../src/types.js';

function summary(dryRun = false): ReconcileSummary {
  return {
    workspaceId: 'workspace-123',
    dryRun,
    results: [
      {
        email: 'ready@example.com',
        workspaceRole: 'Editor',
        lifecycle: 'provisioned',
        workspaceAccess: dryRun ? 'would-add' : 'added'
      },
      {
        email: 'pending@example.com',
        workspaceRole: 'Viewer',
        lifecycle: 'provisioned',
        workspaceAccess: dryRun ? 'would-add' : 'pending'
      }
    ],
    counts: dryRun
      ? { added: 0, invited: 0, pending: 0, skipped: 2, failed: 0 }
      : { added: 1, invited: 2, pending: 1, skipped: 0, failed: 0 }
  };
}

describe('Deloitte onboarding notifications', () => {
  it('renders plain-text and escaped HTML for every scanner result', () => {
    const envelope = buildNotificationEnvelope(summary(), {
      workspaceUrl: 'https://go.postman.co/workspace/example',
      sourceRepository: 'deloitte/api-<platform>'
    });

    expect(envelope.notifications).toHaveLength(2);
    expect(envelope.notifications[0]).toMatchObject({
      to: 'ready@example.com',
      status: 'ready',
      send: true,
      workspaceRole: 'Editor'
    });
    expect(envelope.notifications[0]?.text).toContain('Three useful ways to get started');
    expect(envelope.notifications[0]?.html).toContain('deloitte/api-&lt;platform&gt;');
    expect(envelope.notifications[1]).toMatchObject({
      to: 'pending@example.com',
      status: 'invitation-pending',
      send: true
    });
    expect(envelope.notifications[1]?.text).toContain('Accept the Postman invitation');
  });

  it('rejects unsafe workspace links and strips subject line breaks', () => {
    expect(() => buildNotificationEnvelope(summary(), {
      workspaceUrl: 'javascript:alert(1)'
    })).toThrow(/credential-free HTTPS URL/);
    expect(buildNotificationEnvelope(summary(), {
      subject: 'Deloitte access\r\nBcc: attacker@example.com'
    }).notifications[0]?.subject).toBe('Deloitte access Bcc: attacker@example.com');
  });

  it('renders previews but prevents their delivery', async () => {
    const envelope = buildNotificationEnvelope(summary(true));
    const fetchImpl = vi.fn();
    const delivered = await deliverNotificationEnvelope(envelope, {
      webhookUrl: 'https://notifications.example.com/postman',
      fetchImpl
    });

    expect(delivered).toBe(0);
    expect(envelope.notifications.every(({ send }) => !send)).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('delivers one authenticated batch with an idempotency key', async () => {
    const envelope = buildNotificationEnvelope(summary());
    let capturedInit: RequestInit | undefined;
    const fetchImpl: FetchLike = vi.fn(async (_input, init) => {
      capturedInit = init;
      return new Response('{}', { status: 202 });
    });
    const delivered = await deliverNotificationEnvelope(envelope, {
      webhookUrl: 'https://notifications.example.com/postman',
      token: 'mail-secret',
      idempotencyKey: 'run-123',
      fetchImpl
    });

    expect(delivered).toBe(2);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(capturedInit?.headers).toMatchObject({
      authorization: 'Bearer mail-secret',
      'idempotency-key': 'run-123'
    });
    expect(JSON.parse(String(capturedInit?.body)).notifications).toHaveLength(2);
  });

  it('retries a transient gateway response only with idempotency protection', async () => {
    const envelope = buildNotificationEnvelope(summary());
    let attempt = 0;
    const fetchImpl: FetchLike = vi.fn(async () => {
      attempt += 1;
      return attempt === 1
        ? new Response('{}', { status: 503, headers: { 'retry-after': '0' } })
        : new Response('{}', { status: 202 });
    });
    await expect(deliverNotificationEnvelope(envelope, {
      webhookUrl: 'https://notifications.example.com/postman',
      idempotencyKey: 'retry-safe-run',
      fetchImpl
    })).resolves.toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('fails closed on an insecure remote endpoint or rejected batch', async () => {
    const envelope = buildNotificationEnvelope(summary());
    await expect(deliverNotificationEnvelope(envelope, {
      webhookUrl: 'http://notifications.example.com/postman'
    })).rejects.toThrow(/must use HTTPS/);
    await expect(deliverNotificationEnvelope(envelope, {
      webhookUrl: 'https://notifications.example.com/postman',
      fetchImpl: async () => new Response('{"error":"rejected"}', { status: 400 })
    })).rejects.toThrow(/HTTP 400/);
  });

  it('adds adoption links and enforces the recipient-domain allowlist', async () => {
    const envelope = buildNotificationEnvelope(summary(), {
      gettingStartedUrl: 'https://learning.postman.com/docs/getting-started/overview/',
      helpUrl: 'https://support.postman.com/',
      allowedDomains: ['@deloitte.com']
    });
    expect(envelope.notifications[0]?.text).toContain('Start here: https://learning.postman.com/');
    expect(envelope.notifications[0]?.html).toContain('Get help with access');
    await expect(deliverNotificationEnvelope(envelope, {
      webhookUrl: 'https://notifications.example.com/postman',
      fetchImpl: async () => new Response('{}', { status: 202 })
    })).rejects.toThrow(/outside the configured domain allowlist/);
  });

  it('writes a private JSON artifact containing both email bodies', async () => {
    const directory = process.env.RUNNER_TEMP ?? process.cwd();
    const path = join(directory, `.notification-test-${process.pid}.json`);
    const envelope = buildNotificationEnvelope(summary());
    try {
      expect(await writeNotificationEnvelope(path, envelope)).toBe(path);
      const written = JSON.parse(await readFile(path, 'utf8'));
      expect(written.notifications[0]).toMatchObject({ to: 'ready@example.com' });
      expect(written.notifications[0].text).toBeTruthy();
      expect(written.notifications[0].html).toBeTruthy();
    } finally {
      await import('node:fs/promises').then(({ rm }) => rm(path, { force: true }));
    }
  });
});
