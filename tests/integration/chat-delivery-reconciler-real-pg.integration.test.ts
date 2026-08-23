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

  it('4. 0056 runtime model: normalized scopes, immutable specs, and generation state', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const runtimeSessionId = '73000000-0000-4000-8000-000000000001';
      const scopeId = '74000000-0000-4000-8000-000000000001';
      const agentVersionId = '72000000-0000-4000-8000-000000000001';
      const createdAt = '2026-08-22T08:00:00.000Z';

      await client.query(
        `INSERT INTO runtime_sessions
          (id,tenant_id,workspace_id,principal_type,principal_id,
           scope_kind,scope_id,scope_epoch,desired_spec_revision,
           current_generation_id,status,created_at,updated_at,closed_at)
         VALUES($1,$2,$3,$4,$5,'agent_chat',$6,1,1,NULL,'provisioning',$7,$7,NULL)`,
        [
          runtimeSessionId,
          tenantId,
          'workspace-test',
          'service_account',
          'sa-runtime-model-test',
          scopeId,
          createdAt,
        ],
      );

      await client.query(
        `INSERT INTO runtime_session_specs
          (runtime_session_id,revision,workspace_id,agent_version_id,
           environment_version_id,resolved_skills,tool_refs,provider,model,
           cwd,system_prompt_digest,skill_set_digest,tool_catalog_digest,
           extension_set_digest,context_epoch,bootstrap_digest,created_at)
         VALUES($1,1,$2,$3,NULL,'[]'::jsonb,'[]'::jsonb,'paseo',NULL,
                '/workspace','system','skills','tools','extensions',1,
                'bootstrap',$4)`,
        [runtimeSessionId, 'workspace-test', agentVersionId, createdAt],
      );

      const session = await client.query<{
        scope_kind: string;
        scope_id: string;
        scope_epoch: number;
        desired_spec_revision: number;
        status: string;
      }>(
        `SELECT scope_kind,scope_id,scope_epoch,desired_spec_revision,status
           FROM runtime_sessions WHERE id=$1`,
        [runtimeSessionId],
      );
      expect(session.rows).toEqual([
        {
          scope_kind: 'agent_chat',
          scope_id: scopeId,
          scope_epoch: 1,
          desired_spec_revision: 1,
          status: 'provisioning',
        },
      ]);

      await client.query('SAVEPOINT immutable_spec_update');
      await expect(
        client.query(
          `UPDATE runtime_session_specs
              SET agent_version_id=$2
            WHERE runtime_session_id=$1 AND revision=1`,
          [runtimeSessionId, '72000000-0000-4000-8000-000000000002'],
        ),
      ).rejects.toThrow(/immutable/i);
      await client.query('ROLLBACK TO SAVEPOINT immutable_spec_update');

      const spec = await client.query<{ agent_version_id: string }>(
        `SELECT agent_version_id
           FROM runtime_session_specs
          WHERE runtime_session_id=$1 AND revision=1`,
        [runtimeSessionId],
      );
      expect(spec.rows).toEqual([{ agent_version_id: agentVersionId }]);

      const provisioningGenerationId =
        '75000000-0000-4000-8000-000000000001';
      await client.query(
        `INSERT INTO runtime_session_generations
          (id,runtime_session_id,generation,provider,provider_workspace_id,
           provider_session_id,applied_spec_revision,applied_bootstrap_digest,
           endpoint_epoch,status,created_at)
         VALUES($1,$2,1,'paseo',NULL,NULL,1,'bootstrap','endpoint-1',
                'provisioning',$3)`,
        [provisioningGenerationId, runtimeSessionId, createdAt],
      );

      await client.query('SAVEPOINT active_provider_check');
      await expect(
        client.query(
          `INSERT INTO runtime_session_generations
           (id,runtime_session_id,generation,provider,provider_workspace_id,
             provider_session_id,applied_spec_revision,applied_bootstrap_digest,
             endpoint_epoch,status,created_at)
           VALUES($1,$2,2,'paseo',NULL,NULL,1,'bootstrap','endpoint-2','active',$3)`,
          [
            '75000000-0000-4000-8000-000000000002',
            runtimeSessionId,
            createdAt,
          ],
        ),
      ).rejects.toThrow(/check constraint|violates check/i);
      await client.query('ROLLBACK TO SAVEPOINT active_provider_check');

      await client.query(
        `INSERT INTO runtime_session_generations
          (id,runtime_session_id,generation,provider,provider_workspace_id,
           provider_session_id,applied_spec_revision,applied_bootstrap_digest,
           endpoint_epoch,status,created_at)
         VALUES($1,$2,2,'paseo','provider-workspace-1','provider-session-1',
                1,'bootstrap','endpoint-2','active',$3)`,
        ['75000000-0000-4000-8000-000000000003', runtimeSessionId, createdAt],
      );
      await client.query(
        `INSERT INTO runtime_session_generations
          (id,runtime_session_id,generation,provider,provider_workspace_id,
           provider_session_id,applied_spec_revision,applied_bootstrap_digest,
           endpoint_epoch,status,created_at)
         VALUES($1,$2,3,'paseo','provider-workspace-1','provider-session-1',
                1,'bootstrap','endpoint-3','superseded',$3)`,
        ['75000000-0000-4000-8000-000000000004', runtimeSessionId, createdAt],
      );

      const generations = await client.query<{ status: string }>(
        `SELECT status FROM runtime_session_generations
          WHERE runtime_session_id=$1 ORDER BY generation`,
        [runtimeSessionId],
      );
      expect(generations.rows).toEqual([
        { status: 'provisioning' },
        { status: 'active' },
        { status: 'superseded' },
      ]);

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
