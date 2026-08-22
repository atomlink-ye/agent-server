import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import {
  applyDurableKernelMigrations,
  createPostgresPool,
} from '../../src/infrastructure/postgres/postgres.js';
import { PostgresConversationRepository } from '../../src/infrastructure/postgres/postgres-conversation-repository.js';
import { PostgresConversationWorkLinkRepository } from '../../src/modules/work/conversation-work-link-repository.js';
import { PostgresChatDispatchRepository } from '../../src/infrastructure/postgres/postgres-chat-dispatch-repository.js';
import { ChatDeliveryReconciler } from '../../src/application/chat/chat-delivery-reconciler.js';
import { ChatDeliveryWorker } from '../../src/entrypoints/chat/worker.js';
import { ChatBrainResolver } from '../../src/application/chat/chat-brain-resolver.js';
import type { AgentResolutionApi } from '../../src/application/ports/agent-resolution-api.js';
import { MockChatTurnProvider } from '../../src/adapters/chat/mock-chat-turn-provider.js';
import { postConversationMessage } from '../../src/application/chat/post-conversation-message.js';
import { enqueueChatDispatchForMessage } from '../../src/application/chat/enqueue-chat-dispatch.js';

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!connectionString)
  throw new Error(
    'real PostgreSQL integration requires DATABASE_URL or POSTGRES_URL',
  );

const tenantId = 'chat-delivery-test';
const tenantIdT2 = 'chat-delivery-test-t2';

const principalAuthor = (
  tenantId: string,
  conversationId: string,
  principalId: string,
) => ({
  type: 'principal' as const,
  tenantId,
  conversationId,
  principalType: 'service_account',
  principalId,
});

function createTestBrainResolver(): ChatBrainResolver {
  const managedDefinitions = {
    findManagedDefinitionByTenant: async (input: {
      readonly tenantId: string;
      readonly definitionId: string;
    }) =>
      Object.freeze({
        id: input.definitionId,
        tenantId: input.tenantId,
        workspaceId: 'workspace-test',
        principalType: 'service_account',
        principalId: 'service-account-test',
        normalizedName: 'test-agent',
        displayName: 'Test Agent',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        roleLabel: null,
        summary: null,
      }),
  };
  const agentResolution: AgentResolutionApi = {
    resolvePublished: async (versionId) => ({
      source: 'managed',
      id: versionId,
      instructions: 'test instructions',
      modelPolicyRef: 'free-only',
      skills: [],
      toolRefs: [],
    }),
  };
  return new ChatBrainResolver(managedDefinitions, agentResolution, {
    execute: async () => [],
  });
}

describe('Chat delivery reconciler on real PostgreSQL', () => {
  let pool: Pool;
  let convRepo: PostgresConversationRepository;
  let dispatchRepo: PostgresChatDispatchRepository;
  let conversationWorkLinks: PostgresConversationWorkLinkRepository;

  beforeAll(async () => {
    pool = createPostgresPool({
      connectionString: connectionString!,
      maxConnections: 5,
    });
    await applyDurableKernelMigrations(pool);
    convRepo = new PostgresConversationRepository(pool);
    dispatchRepo = new PostgresChatDispatchRepository(pool);
    conversationWorkLinks = new PostgresConversationWorkLinkRepository(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('1. golden path end-to-end: message → enqueue → reconcile → reply materialized', async () => {
    const sa1 = 'sa-delivery-golden-1';
    const agentD = 'agent-def-delivery-golden-1';

    // Ensure agent runtime exists with v1
    await convRepo.ensureChatRuntime({
      tenantId,
      agentDefinitionId: agentD,
      activeAgentVersionId: 'v1',
    });

    // Create direct conversation
    const conv = await convRepo.findOrCreateDirect({
      tenantId,
      principalId: sa1,
      principalType: 'service_account',
      agentDefinitionId: agentD,
    });

    // Post principal message
    await postConversationMessage(convRepo, {
      author: principalAuthor(tenantId, conv.id, sa1),
      body: 'Hello agent',
    });

    // Get messages and last read to determine activation
    const messages = await convRepo.listMessages({
      tenantId,
      conversationId: conv.id,
    });
    expect(messages).toHaveLength(1);
    const latestSequence = messages[messages.length - 1]!.sequence;

    // Enqueue dispatch
    const enqueued = await enqueueChatDispatchForMessage(dispatchRepo, {
      tenantId,
      conversationId: conv.id,
      agentDefinitionId: agentD,
      lastReadSequence: 0,
      latestMessageSequence: latestSequence,
      latestMessageAuthorType: 'principal',
      debounceMs: 0,
    });
    expect(enqueued).toBe(true);

    // Reconcile pending dispatches
    const reconciler = new ChatDeliveryReconciler(
      convRepo,
      dispatchRepo,
      new MockChatTurnProvider(),
      createTestBrainResolver(),
      conversationWorkLinks,
    );
    const worker = new ChatDeliveryWorker(dispatchRepo, reconciler, {
      workerId: 'chat-delivery-golden-worker',
      leaseMs: 60_000,
    });
    await expect(worker.step()).resolves.toMatchObject({ kind: 'processed' });

    // Verify agent reply was materialized
    const messagesAfter = await convRepo.listMessages({
      tenantId,
      conversationId: conv.id,
    });
    expect(messagesAfter).toHaveLength(2);
    const agentReply = messagesAfter[1]!;
    expect(agentReply.authorType).toBe('agent_definition');
    expect(agentReply.authorId).toBe(agentD);
    expect(agentReply.agentVersionId).toBe('v1');
    expect(agentReply.runtimeEpoch).toBe(1);
    expect(agentReply.body).toContain('[mock reply]');
    expect(agentReply.body).toContain('Hello agent');

    // Verify dispatch was marked published
    const dispatchesAfter = await pool.query<{
      published_at: string | null;
    }>(`SELECT published_at FROM chat_dispatches WHERE conversation_id=$1`, [
      conv.id,
    ]);
    expect(dispatchesAfter.rows?.length).toBe(1);
    expect(dispatchesAfter.rows?.[0]?.published_at).not.toBeNull();
  });

  it('2. three-table regression: chat plane never creates tasks/runs/run_dispatches', async () => {
    const sa1 = 'sa-delivery-work-check-1';
    const agentD = 'agent-def-delivery-work-check-1';

    await convRepo.ensureChatRuntime({
      tenantId,
      agentDefinitionId: agentD,
      activeAgentVersionId: 'v1',
    });

    const conv = await convRepo.findOrCreateDirect({
      tenantId,
      principalId: sa1,
      principalType: 'service_account',
      agentDefinitionId: agentD,
    });

    const taskCountBefore = await pool.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM tasks',
    );
    const tasksBefore = Number(taskCountBefore.rows?.[0]?.count ?? 0);

    const runCountBefore = await pool.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM runs',
    );
    const runsBefore = Number(runCountBefore.rows?.[0]?.count ?? 0);

    const dispatchCountBefore = await pool.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM run_dispatches',
    );
    const dispatchesBefore = Number(dispatchCountBefore.rows?.[0]?.count ?? 0);

    // Full delivery flow
    await postConversationMessage(convRepo, {
      author: principalAuthor(tenantId, conv.id, sa1),
      body: 'Test message',
    });

    const messages = await convRepo.listMessages({
      tenantId,
      conversationId: conv.id,
    });
    const latestSequence = messages[messages.length - 1]!.sequence;

    await enqueueChatDispatchForMessage(dispatchRepo, {
      tenantId,
      conversationId: conv.id,
      agentDefinitionId: agentD,
      lastReadSequence: 0,
      latestMessageSequence: latestSequence,
      latestMessageAuthorType: 'principal',
      debounceMs: 0,
    });

    const reconciler = new ChatDeliveryReconciler(
      convRepo,
      dispatchRepo,
      new MockChatTurnProvider(),
      createTestBrainResolver(),
      conversationWorkLinks,
    );
    const worker = new ChatDeliveryWorker(dispatchRepo, reconciler, {
      workerId: 'chat-delivery-work-check-worker',
      leaseMs: 60_000,
    });
    await expect(worker.step()).resolves.toMatchObject({ kind: 'processed' });

    // Verify work tables are EXACTLY UNCHANGED
    const taskCountAfter = await pool.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM tasks',
    );
    const tasksAfter = Number(taskCountAfter.rows?.[0]?.count ?? 0);
    expect(tasksAfter).toBe(tasksBefore);

    const runCountAfter = await pool.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM runs',
    );
    const runsAfter = Number(runCountAfter.rows?.[0]?.count ?? 0);
    expect(runsAfter).toBe(runsBefore);

    const dispatchCountAfter = await pool.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM run_dispatches',
    );
    const dispatchesAfter = Number(dispatchCountAfter.rows?.[0]?.count ?? 0);
    expect(dispatchesAfter).toBe(dispatchesBefore);
  });

  it("3. D4 guard real-Postgres variant: Bob's conversation does not leak Alice's messages", async () => {
    const saAlice = 'sa-delivery-alice-1';
    const saBob = 'sa-delivery-bob-1';
    const agentD = 'agent-def-delivery-d4-guard-1';

    await convRepo.ensureChatRuntime({
      tenantId: tenantIdT2,
      agentDefinitionId: agentD,
      activeAgentVersionId: 'v1',
    });

    // Create Alice's conversation
    const convAlice = await convRepo.findOrCreateDirect({
      tenantId: tenantIdT2,
      principalId: saAlice,
      principalType: 'service_account',
      agentDefinitionId: agentD,
    });

    // Create Bob's conversation (different principal, same agent)
    const convBob = await convRepo.findOrCreateDirect({
      tenantId: tenantIdT2,
      principalId: saBob,
      principalType: 'service_account',
      agentDefinitionId: agentD,
    });

    // Alice posts a secret message
    await postConversationMessage(convRepo, {
      author: principalAuthor(tenantIdT2, convAlice.id, saAlice),
      body: "Alice's secret is xyz789",
    });

    // Reconcile Alice's dispatch first
    const aliceMessages = await convRepo.listMessages({
      tenantId: tenantIdT2,
      conversationId: convAlice.id,
    });
    const aliceLatestSequence = aliceMessages[0]!.sequence;

    await enqueueChatDispatchForMessage(dispatchRepo, {
      tenantId: tenantIdT2,
      conversationId: convAlice.id,
      agentDefinitionId: agentD,
      lastReadSequence: 0,
      latestMessageSequence: aliceLatestSequence,
      latestMessageAuthorType: 'principal',
      debounceMs: 0,
    });

    const reconciler = new ChatDeliveryReconciler(
      convRepo,
      dispatchRepo,
      new MockChatTurnProvider(),
      createTestBrainResolver(),
      conversationWorkLinks,
    );
    const worker = new ChatDeliveryWorker(dispatchRepo, reconciler, {
      workerId: 'chat-delivery-d4-guard-worker',
      leaseMs: 60_000,
    });
    await expect(worker.step()).resolves.toMatchObject({ kind: 'processed' });

    // Bob posts a message
    await postConversationMessage(convRepo, {
      author: principalAuthor(tenantIdT2, convBob.id, saBob),
      body: "What's up?",
    });

    // Enqueue and reconcile Bob's dispatch
    const bobMessages = await convRepo.listMessages({
      tenantId: tenantIdT2,
      conversationId: convBob.id,
    });
    const bobLatestSequence = bobMessages[0]!.sequence;

    await enqueueChatDispatchForMessage(dispatchRepo, {
      tenantId: tenantIdT2,
      conversationId: convBob.id,
      agentDefinitionId: agentD,
      lastReadSequence: 0,
      latestMessageSequence: bobLatestSequence,
      latestMessageAuthorType: 'principal',
      debounceMs: 0,
    });

    await expect(worker.step()).resolves.toMatchObject({ kind: 'processed' });

    // Verify Bob's conversation messages do NOT contain Alice's secret
    const bobMessagesAfter = await pool.query<{ body: string }>(
      `SELECT body FROM chat_messages WHERE conversation_id=$1 ORDER BY sequence ASC`,
      [convBob.id],
    );

    const allBobBodies = (bobMessagesAfter.rows ?? [])
      .map((r) => r.body)
      .join(' ');
    expect(allBobBodies).not.toContain('xyz789');
    expect(allBobBodies).not.toContain('Alice');
  });

  it('4. scope_kind mutation: agent_chat scope is now allowed in runtime_sessions', async () => {
    // This test verifies the migration 0039 scope plus 0051 typed epoch shape.
    // We test within a transaction that is always rolled back to avoid pollution.

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Drop FK constraints that would block synthetic row insertion
      const fkConstraintsResult = await client.query<{ conname: string }>(
        `SELECT conname FROM pg_constraint
         WHERE conrelid='runtime_sessions'::regclass AND contype='f'`,
      );

      const fkNames = (fkConstraintsResult.rows ?? []).map((r) => r.conname);
      for (const fkName of fkNames) {
        await client.query(
          `ALTER TABLE runtime_sessions DROP CONSTRAINT IF EXISTS "${fkName}"`,
        );
      }

      // Positive: current schema allows typed agent_chat scope identity.
      await client.query('SAVEPOINT test_agent_chat_allowed');
      const insertResult = await client.query(
        `INSERT INTO runtime_sessions
          (id, tenant_id, principal_type, principal_id, scope_kind, agent_chat_runtime_id, runtime_epoch, launch_snapshot_id, created_at, updated_at)
         VALUES (gen_random_uuid(), 'test-tenant-scope', 'service_account', 'sa-1', 'agent_chat', gen_random_uuid(), 1, gen_random_uuid(), now(), now())`,
      );
      expect(insertResult.rowCount).toBe(1);
      await client.query('ROLLBACK TO SAVEPOINT test_agent_chat_allowed');

      // Negative: before 0039 (old constraints), agent_chat would be rejected.
      await client.query('SAVEPOINT test_old_constraints');

      // Drop current scope constraints. 0051's typed identity check stays in
      // place so this branch isolates the historical scope-kind restriction.
      await client.query(
        `ALTER TABLE runtime_sessions DROP CONSTRAINT IF EXISTS runtime_sessions_scope_shape_check`,
      );
      await client.query(
        `ALTER TABLE runtime_sessions DROP CONSTRAINT IF EXISTS runtime_sessions_scope_kind_check`,
      );

      // Add old (pre-0039) constraints
      await client.query(`
        ALTER TABLE runtime_sessions
        ADD CONSTRAINT runtime_sessions_scope_shape_check CHECK (
          (scope_kind = 'product_session' AND product_session_id IS NOT NULL AND task_id IS NULL)
          OR (scope_kind = 'task' AND product_session_id IS NULL AND task_id IS NOT NULL)
          OR (scope_kind = 'team_member' AND product_session_id IS NULL AND task_id IS NOT NULL)
        ),
        ADD CONSTRAINT runtime_sessions_scope_kind_check
          CHECK (scope_kind IN ('product_session','task','team_member'))
      `);

      // Attempt to insert a structurally typed agent_chat under old constraints.
      let oldConstraintRejectsAgentChat = false;
      try {
        await client.query(
          `INSERT INTO runtime_sessions
            (id, tenant_id, principal_type, principal_id, scope_kind, agent_chat_runtime_id, runtime_epoch, launch_snapshot_id, created_at, updated_at)
           VALUES (gen_random_uuid(), 'test-tenant-scope-old', 'service_account', 'sa-2', 'agent_chat', gen_random_uuid(), 1, gen_random_uuid(), now(), now())`,
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes('violates check constraint')
        ) {
          oldConstraintRejectsAgentChat = true;
        }
      }
      expect(oldConstraintRejectsAgentChat).toBe(true);

      await client.query('ROLLBACK TO SAVEPOINT test_old_constraints');

      // Final rollback to ensure no data is committed
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
