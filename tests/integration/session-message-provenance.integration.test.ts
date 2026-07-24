import { afterEach, describe, expect, it } from 'vitest';
import {
  createTestApp,
  defaultPublishedAgentVersionId,
  primaryServiceAccountToken,
} from '../fixtures/create-test-app.js';
import { FakeAgentRuntime } from '../fixtures/fake-agent-runtime.js';
import { PostgresTaskRepository } from '../../src/infrastructure/postgres/postgres-task-repository.js';
import { PostgresAdmissionRepository } from '../../src/infrastructure/postgres/postgres-admission-repository.js';
import { createRootTask } from '../../src/domain/tasks/task.js';

describe('Product Session message provenance on PGlite', () => {
  const databases: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    for (const database of databases.splice(0)) await database.close();
  });

  it('preserves postMessage message identity when reloading its Task', async () => {
    const databaseControl: { database?: any } = {};
    const sessionControl: { repository?: any } = {};
    await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
      workspaceId: '00000000-0000-4000-8000-00000000f011',
      databaseControl: databaseControl as never,
      sessionRepositoryControl: sessionControl as never,
    });
    databases.push(databaseControl.database!);
    const owner = {
      tenantId: 'tenant_alpha',
      workspaceId: '00000000-0000-4000-8000-00000000f011',
      principalType: 'service_account' as const,
      principalId: 'svc_enabled',
      policySnapshotVersion: 'policy-2026-07-22',
    };
    const session = await sessionControl.repository!.createSession({
      workspaceId: owner.workspaceId,
      agentVersionId: defaultPublishedAgentVersionId,
      owner,
    });
    const message = await sessionControl.repository!.postMessage({
      sessionId: session.id,
      text: 'provenance regression',
      idempotencyKey: 'pglite-provenance',
      owner,
      origin: { channel: 'api', requestId: 'provenance-request' },
    });
    const task = await new PostgresTaskRepository(
      databaseControl.database!,
    ).findById(message.taskId);
    expect(task?.sourceMessageId).toBe(message.id);
  });

  it('does not replay an idempotency key from a different Product Session', async () => {
    const databaseControl: { database?: any } = {};
    const sessionControl: { repository?: any } = {};
    await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
      workspaceId: '00000000-0000-0000-0000-00000000f012',
      databaseControl,
      sessionRepositoryControl: sessionControl,
    });
    databases.push(databaseControl.database!);
    const owner = {
      tenantId: 'tenant_alpha',
      workspaceId: '00000000-0000-0000-0000-00000000f012',
      principalType: 'service_account' as const,
      principalId: 'svc_enabled',
      policySnapshotVersion: 'policy-2026-07-22',
    };
    const firstSession = await sessionControl.repository.createSession({
      workspaceId: owner.workspaceId,
      agentVersionId: defaultPublishedAgentVersionId,
      owner,
    });
    const secondSession = await sessionControl.repository.createSession({
      workspaceId: owner.workspaceId,
      agentVersionId: defaultPublishedAgentVersionId,
      owner,
    });

    const first = await sessionControl.repository.postMessage({
      sessionId: firstSession.id,
      text: 'first session text',
      idempotencyKey: 'shared-session-key',
      owner,
      origin: { channel: 'api', requestId: 'request-1' },
    });
    const second = await sessionControl.repository.postMessage({
      sessionId: secondSession.id,
      text: 'second session text',
      idempotencyKey: 'shared-session-key',
      owner,
      origin: { channel: 'api', requestId: 'request-2' },
    });
    const third = await sessionControl.repository.postMessage({
      sessionId: secondSession.id,
      text: 'third submission must replay',
      idempotencyKey: 'shared-session-key',
      owner,
      origin: { channel: 'api', requestId: 'request-3' },
    });

    expect(second.sessionId).toBe(secondSession.id);
    expect(second.id).not.toBe(first.id);
    expect(second.text).toBe('second session text');
    expect(third).toMatchObject({
      id: second.id,
      sessionId: secondSession.id,
      text: 'second session text',
    });

    const counts = await databaseControl.database!.query(
      `
        SELECT m.session_id, COUNT(DISTINCT m.id)::int message_count,
               COUNT(DISTINCT t.id)::int task_count,
               COUNT(DISTINCT a.id)::int admission_count
        FROM messages m
        JOIN tasks t ON t.id = m.task_id
        JOIN admissions a ON a.task_id = t.id
        WHERE m.session_id IN ($1, $2)
        GROUP BY m.session_id
        ORDER BY m.session_id
      `,
      [firstSession.id, secondSession.id],
    );
    expect(counts.rows).toHaveLength(2);
    for (const sessionId of [firstSession.id, secondSession.id]) {
      expect(counts.rows).toContainEqual({
        session_id: sessionId,
        message_count: 1,
        task_count: 1,
        admission_count: 1,
      });
    }
  });

  it('preserves Lark origin semantics across Task and Admission persistence', async () => {
    const databaseControl: { database?: any } = {};
    const sessionControl: { repository?: any } = {};
    await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
      workspaceId: '00000000-0000-0000-0000-00000000f013',
      databaseControl,
      sessionRepositoryControl: sessionControl,
    });
    databases.push(databaseControl.database!);
    const owner = {
      tenantId: 'tenant_alpha',
      workspaceId: '00000000-0000-0000-0000-00000000f013',
      principalType: 'service_account' as const,
      principalId: 'svc_enabled',
      policySnapshotVersion: 'policy-2026-07-22',
    };
    const session = await sessionControl.repository.createSession({
      workspaceId: owner.workspaceId,
      agentVersionId: defaultPublishedAgentVersionId,
      owner,
    });
    const message = await sessionControl.repository.postMessage({
      sessionId: session.id,
      text: 'lark parity',
      idempotencyKey: 'lark-parity-key',
      owner,
      origin: { channel: 'lark', ingressEventId: 'feishu-event-1' },
    });

    const rows = await databaseControl.database!.query(
      `
        SELECT t.ingress task_ingress, t.origin_ref task_origin_ref,
               a.ingress admission_ingress, a.origin_ref admission_origin_ref
        FROM tasks t
        JOIN admissions a ON a.task_id = t.id
        WHERE t.id = $1
      `,
      [message.taskId],
    );
    expect(rows.rows).toEqual([
      {
        task_ingress: 'lark',
        task_origin_ref: 'feishu-event-1',
        admission_ingress: 'lark',
        admission_origin_ref: 'feishu-event-1',
      },
    ]);
  });

  it('returns the non-Session admission when a session uses the same key', async () => {
    const databaseControl: { database?: any } = {};
    const sessionControl: { repository?: any } = {};
    await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
      workspaceId: '00000000-0000-0000-0000-00000000f014',
      databaseControl,
      sessionRepositoryControl: sessionControl,
    });
    databases.push(databaseControl.database!);
    const owner = {
      tenantId: 'tenant_alpha',
      workspaceId: '00000000-0000-0000-0000-00000000f014',
      principalType: 'service_account' as const,
      principalId: 'svc_enabled',
      policySnapshotVersion: 'policy-2026-07-22',
    };
    const session = await sessionControl.repository.createSession({
      workspaceId: owner.workspaceId,
      agentVersionId: defaultPublishedAgentVersionId,
      owner,
    });
    await sessionControl.repository.postMessage({
      sessionId: session.id,
      text: 'session admission',
      idempotencyKey: 'shared-admission-key',
      owner,
      origin: { channel: 'api', requestId: 'session-request' },
    });

    const nonSessionTask = createRootTask({
      id: '00000000-0000-0000-0000-00000000f015',
      ...owner,
      ingress: 'api',
      originRef: null,
      invokableKind: 'agent',
      invokableVersionId: defaultPublishedAgentVersionId,
      inputSnapshotRef: 'inline:non-session',
      inputFingerprint: 'sha256:non-session',
    });
    await new PostgresTaskRepository(databaseControl.database!).save(
      nonSessionTask,
    );
    const admissions = new PostgresAdmissionRepository(
      databaseControl.database!,
    );
    await admissions.withTransaction(async (transaction) => {
      await transaction.save({
        ingress: 'api',
        originRef: null,
        idempotencyKey: 'shared-admission-key',
        requestFingerprint: 'sha256:non-session',
        taskId: nonSessionTask.id,
        ...owner,
        createdAt: nonSessionTask.createdAt,
      });

      await expect(
        transaction.findByIngressAndIdempotencyKey(
          'api',
          'shared-admission-key',
          owner,
        ),
      ).resolves.toMatchObject({
        taskId: nonSessionTask.id,
        sessionId: null,
      });
    });
  });

  it('keeps authenticated root invoke replay separate from a Session admission', async () => {
    const databaseControl: { database?: any } = {};
    const sessionControl: { repository?: any } = {};
    const app = await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
      workspaceId: '00000000-0000-0000-0000-00000000f016',
      databaseControl,
      sessionRepositoryControl: sessionControl,
    });
    databases.push(databaseControl.database!);
    const owner = {
      tenantId: 'tenant_alpha',
      workspaceId: '00000000-0000-0000-0000-00000000f016',
      principalType: 'service_account' as const,
      principalId: 'svc_enabled',
      policySnapshotVersion: 'policy-2026-07-22',
    };
    const session = await sessionControl.repository.createSession({
      workspaceId: owner.workspaceId,
      agentVersionId: defaultPublishedAgentVersionId,
      owner,
    });
    const sessionMessage = await sessionControl.repository.postMessage({
      sessionId: session.id,
      text: 'session turn with shared key',
      idempotencyKey: 'shared-http-key',
      owner,
      origin: { channel: 'api', requestId: 'session-request' },
    });

    const request = {
      invokable: { kind: 'agent', version_id: defaultPublishedAgentVersionId },
      input: { text: 'root invoke with shared key' },
    };
    const headers = {
      authorization: `Bearer ${primaryServiceAccountToken}`,
      'content-type': 'application/json',
      'idempotency-key': 'shared-http-key',
    };
    const firstResponse = await app.request('/api/v1/tasks:invoke', {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });
    expect(firstResponse.status).toBe(202);
    const first = (await firstResponse.json()) as { task_id: string };
    expect(first.task_id).not.toBe(sessionMessage.taskId);

    const replayResponse = await app.request('/api/v1/tasks:invoke', {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });
    expect(replayResponse.status).toBe(202);
    const replay = (await replayResponse.json()) as { task_id: string };
    expect(replay.task_id).toBe(first.task_id);

    const rows = await databaseControl.database!.query(
      `
        SELECT a.session_id, a.task_id, t.session_id AS task_session_id
        FROM admissions a
        JOIN tasks t ON t.id = a.task_id
        WHERE a.ingress = 'api' AND a.idempotency_key = $1
        ORDER BY a.session_id NULLS LAST
      `,
      ['shared-http-key'],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows).toContainEqual({
      session_id: session.id,
      task_id: sessionMessage.taskId,
      task_session_id: session.id,
    });
    expect(rows.rows).toContainEqual({
      session_id: null,
      task_id: first.task_id,
      task_session_id: null,
    });
  });
});
