import { afterEach, describe, expect, it } from 'vitest';
import {
  createTestApp,
  defaultPublishedAgentVersionId,
} from '../fixtures/create-test-app.js';
import { FakeAgentRuntime } from '../fixtures/fake-agent-runtime.js';
import { PostgresChannelRepository } from '../../src/infrastructure/postgres/postgres-channel-repository.js';
import { ResolveLarkBinding } from '../../src/application/channels/resolve-lark-binding.js';
import { ProcessChannelIngress } from '../../src/application/channels/process-channel-ingress.js';
import { SubmitSessionTurn } from '../../src/application/sessions/submit-session-turn.js';

describe('Task 6 channel session batch', () => {
  const databases: Array<{ close: () => Promise<void> }> = [];
  const owner = {
    tenantId: 'tenant_alpha',
    workspaceId: '00000000-0000-4000-8000-000000006006',
    principalType: 'service_account' as const,
    principalId: 'svc_enabled',
    policySnapshotVersion: 'policy-2026-07-22',
  };
  const config = {
    enabled: true as const,
    connectionKey: 'lark/task6',
    appId: 'task6-app',
    domain: 'lark' as const,
    appSecret: 'task6-secret',
    tenantId: owner.tenantId,
    workspaceId: owner.workspaceId,
    serviceAccountId: owner.principalId,
    policyVersion: owner.policySnapshotVersion,
    allowedChatId: 'chat-task6',
    allowedOpenId: 'user-task6',
    botOpenId: 'bot-task6',
    publishedAgentVersionId: defaultPublishedAgentVersionId,
  };

  afterEach(async () => {
    for (const database of databases.splice(0)) await database.close();
  });

  it('elects one binding/session under concurrency and creates its lane atomically', async () => {
    const databaseControl: { database?: any } = {};
    const sessionControl: { repository?: any } = {};
    await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
      workspaceId: owner.workspaceId,
      databaseControl,
      sessionRepositoryControl: sessionControl,
    });
    databases.push(databaseControl.database!);
    await seedTask6Fixtures(databaseControl.database!, owner);
    const channel = new PostgresChannelRepository(databaseControl.database!);
    const ingress = {
      id: 'task6-ingress',
      connectionKey: config.connectionKey,
      kind: 'message' as const,
      externalKey: 'task6-event',
      externalMessageId: 'task6-message',
      chatId: config.allowedChatId,
      rootMessageId: 'task6-root',
      externalActorId: config.allowedOpenId,
      botMentionVerified: true,
      text: 'hello',
      normalizationVersion: 'lark-v1',
    };
    const stored = (await channel.insertIngress(ingress)).record;
    const resolver = new ResolveLarkBinding(channel, config);
    await expect(
      resolver.execute({
        ...stored,
        id: 'task6-unknown-chat',
        chatId: 'other-chat',
      }),
    ).resolves.toMatchObject({ accepted: false, reason: 'chat_not_allowed' });
    await expect(
      resolver.execute({
        ...stored,
        id: 'task6-unknown-user',
        externalActorId: 'other-user',
      }),
    ).resolves.toMatchObject({ accepted: false, reason: 'user_not_allowed' });
    await expect(
      resolver.execute({
        ...stored,
        id: 'task6-no-mention',
        botMentionVerified: false,
      }),
    ).resolves.toMatchObject({
      accepted: false,
      reason: 'bot_mention_required',
    });
    const results = await Promise.all([
      resolver.execute(stored),
      resolver.execute({ ...stored, id: 'task6-ingress-2' }),
    ]);
    expect(results[0]).toMatchObject({ accepted: true });
    expect(results[1]).toMatchObject({ accepted: true });
    if (!results[0].accepted || !results[1].accepted)
      throw new Error('not accepted');
    expect(results[0].sessionId).toBe(results[1].sessionId);
    await expect(
      databaseControl.database!.query(
        'SELECT COUNT(*)::int AS count FROM product_sessions WHERE workspace_id = $1',
        [owner.workspaceId],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
    await expect(
      databaseControl.database!.query(
        'SELECT COUNT(*)::int AS count FROM session_lanes',
      ),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it('completes admitted ingress and persists verified mention evidence', async () => {
    const databaseControl: { database?: any } = {};
    await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
      workspaceId: owner.workspaceId,
      databaseControl,
    });
    databases.push(databaseControl.database!);
    await seedTask6Fixtures(databaseControl.database!, owner);
    const channel = new PostgresChannelRepository(databaseControl.database!);
    const inserted = await channel.insertIngress({
      id: 'task6-complete',
      connectionKey: config.connectionKey,
      kind: 'message',
      externalKey: 'task6-complete-event',
      externalMessageId: 'task6-complete-message',
      chatId: config.allowedChatId,
      rootMessageId: 'task6-complete-root',
      externalActorId: config.allowedOpenId,
      botMentionVerified: true,
      text: 'hello',
      normalizationVersion: 'lark-v1',
    });
    await channel.claimIngress('task6-worker', 60_000);
    await channel.completeIngressAdministrative({
      ingressId: inserted.record.id,
      status: 'processed',
    });
    await expect(
      databaseControl.database!.query(
        'SELECT bot_mention_verified, status, lease_owner, admitted_session_id, admitted_task_id FROM channel_ingress_events WHERE id = $1',
        [inserted.record.id],
      ),
    ).resolves.toMatchObject({
      rows: [
        { bot_mention_verified: true, status: 'processed', lease_owner: null },
      ],
    });
  });

  it.each([
    [
      'another owner',
      'foreign-tenant',
      '00000000-0000-4000-8000-000000006007',
      'foreign-principal',
      'foreign-version',
    ],
    [
      'another published version',
      owner.tenantId,
      owner.workspaceId,
      owner.principalId,
      'other-published-version',
    ],
  ])(
    'rejects reuse of a binding session pinned to %s without submitting a turn',
    async (_label, tenantId, workspaceId, principalId, versionId) => {
      const databaseControl: { database?: any } = {};
      await createTestApp(new FakeAgentRuntime(), {
        startDispatcher: false,
        workspaceId: owner.workspaceId,
        databaseControl,
      });
      databases.push(databaseControl.database!);
      await seedTask6Fixtures(databaseControl.database!, owner);
      await databaseControl.database!.query(
        `INSERT INTO workspaces (id, tenant_id, principal_type, principal_id, name, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'foreign workspace', now(), now())
       ON CONFLICT (id) DO NOTHING`,
        [workspaceId, tenantId, 'service_account', principalId],
      );
      const sessionId = crypto.randomUUID();
      await databaseControl.database!.query(
        `INSERT INTO product_sessions
       (id, workspace_id, tenant_id, principal_type, principal_id,
        published_agent_version_id, generation, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'service_account', $4, $5, 0, 'active', now(), now())`,
        [sessionId, workspaceId, tenantId, principalId, versionId],
      );
      await databaseControl.database!.query(
        'INSERT INTO session_lanes(session_id, generation) VALUES ($1, 0)',
        [sessionId],
      );
      const channel = new PostgresChannelRepository(databaseControl.database!);
      const ingress = (
        await channel.insertIngress({
          id: `task6-cross-scope-${sessionId}`,
          connectionKey: config.connectionKey,
          kind: 'message',
          externalKey: `task6-cross-scope-event-${sessionId}`,
          externalMessageId: `task6-cross-scope-message-${sessionId}`,
          chatId: config.allowedChatId,
          rootMessageId: `task6-cross-scope-root-${sessionId}`,
          externalActorId: config.allowedOpenId,
          botMentionVerified: true,
          text: 'must not reuse',
          normalizationVersion: 'lark-v1',
        })
      ).record;
      await channel.resolveBinding({
        id: `task6-cross-scope-binding-${sessionId}`,
        connectionKey: config.connectionKey,
        chatId: ingress.chatId,
        rootMessageId: ingress.rootMessageId!,
        sessionId,
        creatingIngressId: ingress.id,
      });
      await expect(
        new ResolveLarkBinding(channel, config).execute(ingress),
      ).rejects.toThrow('not_found');
      let submits = 0;
      const process = new ProcessChannelIngress(
        new ResolveLarkBinding(channel, config),
        {
          execute: async () => {
            submits += 1;
            throw new Error('turn should not submit');
          },
        },
        channel,
        config,
      );
      await expect(process.execute(ingress)).rejects.toThrow('not_found');
      expect(submits).toBe(0);
    },
  );

  it('processes an allowed ingress through SubmitSessionTurn with one ready-pinned task/run', async () => {
    const databaseControl: { database?: any } = {};
    const sessionControl: { repository?: any } = {};
    const memoryControl: {
      seedAcceptedEntry?: (
        workspaceId: string,
        content: string,
      ) => Promise<{
        proposalId: string;
        entryId: string;
        snapshotId: string;
        contentHash: string;
      }>;
    } = {};
    await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
      workspaceId: owner.workspaceId,
      databaseControl,
      sessionRepositoryControl: sessionControl,
      workspaceMemoryFixtureControl: memoryControl,
    });
    databases.push(databaseControl.database!);
    await seedTask6Fixtures(databaseControl.database!, owner);
    await memoryControl.seedAcceptedEntry!(owner.workspaceId, 'ready memory');
    const channel = new PostgresChannelRepository(databaseControl.database!);
    const ingress = {
      id: 'task6-process',
      connectionKey: config.connectionKey,
      kind: 'message' as const,
      externalKey: 'task6-process-event',
      externalMessageId: 'task6-process-message',
      chatId: config.allowedChatId,
      rootMessageId: 'task6-process-root',
      externalActorId: config.allowedOpenId,
      botMentionVerified: true,
      text: 'run this',
      normalizationVersion: 'lark-v1',
    };
    const stored = (await channel.insertIngress(ingress)).record;
    const claimed = await channel.claimIngress('task6-process-worker', 60_000);
    if (!claimed) throw new Error('task6 ingress was not claimed');
    const process = new ProcessChannelIngress(
      new ResolveLarkBinding(channel, config),
      new SubmitSessionTurn(sessionControl.repository!),
      channel,
      config,
    );
    const result = await process.execute(claimed);
    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error('not accepted');
    const rows = await databaseControl.database!.query(
      `SELECT t.id task_id, r.id run_id, t.ingress, t.origin_ref,
              t.memory_snapshot_id, t.memory_snapshot_hash,
              e.status, e.admitted_session_id, e.admitted_task_id
       FROM tasks t JOIN runs r ON r.task_id = t.id
       JOIN channel_ingress_events e ON e.id = $1`,
      [ingress.id],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      task_id: result.message.taskId,
      run_id: result.message.runId,
      ingress: 'lark',
      origin_ref: ingress.id,
      status: 'processed',
      admitted_session_id: result.sessionId,
      admitted_task_id: result.message.taskId,
    });
    expect(rows.rows[0].memory_snapshot_id).toBeTruthy();
    expect(rows.rows[0].memory_snapshot_hash).toBeTruthy();
  });
});

async function seedTask6Fixtures(
  database: {
    query(sql: string, values?: readonly unknown[]): Promise<unknown>;
  },
  owner: {
    tenantId: string;
    workspaceId: string;
    principalType: string;
    principalId: string;
  },
): Promise<void> {
  const createdAt = '2026-07-24T00:00:00.000Z';
  await database.query(
    `INSERT INTO workspaces
       (id, tenant_id, principal_type, principal_id, name, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'Task 6 workspace', $5, $5)
     ON CONFLICT (id) DO NOTHING`,
    [
      owner.workspaceId,
      owner.tenantId,
      owner.principalType,
      owner.principalId,
      createdAt,
    ],
  );
  await database.query(
    `INSERT INTO agent_definitions
       (id, tenant_id, workspace_id, principal_type, principal_id, name, description, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'Task 6 agent', 'Task 6 fixture', $6, $6)
     ON CONFLICT (id) DO NOTHING`,
    [
      '00000000-0000-4000-8000-0000000a0001',
      owner.tenantId,
      owner.workspaceId,
      owner.principalType,
      owner.principalId,
      createdAt,
    ],
  );
  await database.query(
    `INSERT INTO agent_versions
       (id, definition_id, tenant_id, workspace_id, principal_type, principal_id,
        status, name, description, instructions, created_at, updated_at, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'published', 'Task 6 agent v1',
             'Task 6 fixture', 'Do the task.', $7, $7, $7)
     ON CONFLICT (id) DO NOTHING`,
    [
      defaultPublishedAgentVersionId,
      '00000000-0000-4000-8000-0000000a0001',
      owner.tenantId,
      owner.workspaceId,
      owner.principalType,
      owner.principalId,
      createdAt,
    ],
  );
}
