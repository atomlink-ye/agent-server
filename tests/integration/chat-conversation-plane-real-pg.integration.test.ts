import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import {
  applyDurableKernelMigrations,
  createPostgresPool,
} from '../../src/infrastructure/postgres/postgres.js';
import { PostgresConversationRepository } from '../../src/infrastructure/postgres/postgres-conversation-repository.js';
import { ChatActivationPlanner } from '../../src/application/chat/chat-activation-planner.js';
import { postConversationMessage } from '../../src/application/chat/post-conversation-message.js';

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!connectionString)
  throw new Error(
    'real PostgreSQL integration requires DATABASE_URL or POSTGRES_URL',
  );

const tenantId = 'chat-plane-test';
const tenantIdT2 = 'chat-plane-test-t2';

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

describe('Chat conversation plane on real PostgreSQL', () => {
  let pool: Pool;
  let repo: PostgresConversationRepository;

  beforeAll(async () => {
    pool = createPostgresPool({
      connectionString: connectionString!,
      maxConnections: 5,
    });
    await applyDurableKernelMigrations(pool);
    repo = new PostgresConversationRepository(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('1. findOrCreateDirect is idempotent for the same principal+agent pair', async () => {
    const sa1 = 'sa-idempotent-1';
    const agentD = 'agent-def-idempotent-1';

    const conv1 = await repo.findOrCreateDirect({
      tenantId,
      principalId: sa1,
      principalType: 'service_account',
      agentDefinitionId: agentD,
    });

    const conv2 = await repo.findOrCreateDirect({
      tenantId,
      principalId: sa1,
      principalType: 'service_account',
      agentDefinitionId: agentD,
    });

    expect(conv1.id).toBe(conv2.id);
    expect(conv1.createdAt).toBe(conv2.createdAt);
  });

  it('2. second principal gets independent conversation for the same agent', async () => {
    const sa1 = 'sa-multi-principal-1';
    const sa2 = 'sa-multi-principal-2';
    const agentD = 'agent-def-multi-principal-1';

    const conv1 = await repo.findOrCreateDirect({
      tenantId,
      principalId: sa1,
      principalType: 'service_account',
      agentDefinitionId: agentD,
    });

    const conv2 = await repo.findOrCreateDirect({
      tenantId,
      principalId: sa2,
      principalType: 'service_account',
      agentDefinitionId: agentD,
    });

    expect(conv1.id).not.toBe(conv2.id);
  });

  it('3. membership gate prevents non-member access and mutation pair proves check is real', async () => {
    const sa1 = 'sa-membership-1';
    const sa2 = 'sa-membership-2';
    const agentD = 'agent-def-membership-1';

    // Create direct conversation between SA1 and agent
    const conv = await repo.findOrCreateDirect({
      tenantId,
      principalId: sa1,
      principalType: 'service_account',
      agentDefinitionId: agentD,
    });

    // Negative: SA2 (not a member) should NOT get the conversation
    const nonMemberResult = await repo.getConversation({
      tenantId,
      conversationId: conv.id,
      requesterMemberType: 'principal',
      requesterMemberId: sa2,
    });
    expect(nonMemberResult).toBeNull();

    // Positive: SA1 (legitimate member) SHOULD get the conversation
    const memberResult = await repo.getConversation({
      tenantId,
      conversationId: conv.id,
      requesterMemberType: 'principal',
      requesterMemberId: sa1,
    });
    expect(memberResult).not.toBeNull();
    expect(memberResult?.id).toBe(conv.id);

    // MUTATION PAIR (variant proof): Verify membership check is the gatekeeper
    // by bypassing it with raw SQL and confirming the row exists.
    // This proves: if the membership check were removed from the repository,
    // SA2's query above would return a row instead of null.
    const directConversationQuery = await pool.query<{
      id: string;
    }>(`SELECT id FROM conversations WHERE id=$1 AND tenant_id=$2`, [
      conv.id,
      tenantId,
    ]);
    expect(directConversationQuery.rows?.length).toBe(1);
    expect(directConversationQuery.rows?.[0]?.id).toBe(conv.id);
    // ^ This proves the conversation exists in the database; test 3b's null return
    // comes from the membership check, not from the conversation not existing.
  });

  it('4. central criterion: chat is not work — posting a message does not create tasks/runs/dispatches', async () => {
    const sa1 = 'sa-work-check-1';
    const agentD = 'agent-def-work-check-1';

    // Create conversation
    const conv = await repo.findOrCreateDirect({
      tenantId,
      principalId: sa1,
      principalType: 'service_account',
      agentDefinitionId: agentD,
    });

    // Baseline counts for work tables (should be present, but we're testing they DON'T grow)
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

    // Post a chat message via the application layer
    await postConversationMessage(repo, {
      author: principalAuthor(tenantId, conv.id, sa1),
      body: 'Hello agent!',
    });

    // Verify chat_messages grew by exactly 1
    const messageCountResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM chat_messages WHERE conversation_id=$1`,
      [conv.id],
    );
    const messagesAfter = Number(messageCountResult.rows?.[0]?.count ?? 0);
    expect(messagesAfter).toBe(1);

    // Verify work tables are EXACTLY UNCHANGED (not just non-decreasing)
    const taskCountAfter = await pool.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM tasks',
    );
    const tasksAfter = Number(taskCountAfter.rows?.[0]?.count ?? 0);
    expect(tasksAfter).toBe(tasksBefore); // Must be exact, not >=

    const runCountAfter = await pool.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM runs',
    );
    const runsAfter = Number(runCountAfter.rows?.[0]?.count ?? 0);
    expect(runsAfter).toBe(runsBefore); // Must be exact

    const dispatchCountAfter = await pool.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM run_dispatches',
    );
    const dispatchesAfter = Number(dispatchCountAfter.rows?.[0]?.count ?? 0);
    expect(dispatchesAfter).toBe(dispatchesBefore); // Must be exact

    // This is the central acceptance criterion: chat plane writes ONLY to chat tables,
    // never to Work tables (tasks/runs/run_dispatches).
  });

  it('5. sequence monotonicity under concurrency: multiple appends yield ordered sequences', async () => {
    const sa1 = 'sa-sequence-1';
    const agentD = 'agent-def-sequence-1';

    const conv = await repo.findOrCreateDirect({
      tenantId,
      principalId: sa1,
      principalType: 'service_account',
      agentDefinitionId: agentD,
    });

    // Fire off 5 concurrent message appends to the same conversation
    const messagePromises = Array.from({ length: 5 }, (_, i) =>
      repo.appendMessage({
        author: principalAuthor(tenantId, conv.id, sa1),
        body: `Concurrent message ${i + 1}`,
      }),
    );

    await Promise.all(messagePromises);

    // Verify sequences are exactly [1, 2, 3, 4, 5] with no gaps or duplicates
    const sequenceResult = await pool.query<{ sequence: string }>(
      `SELECT sequence FROM chat_messages WHERE conversation_id=$1 ORDER BY sequence ASC`,
      [conv.id],
    );

    const sequences = (sequenceResult.rows ?? []).map((r) =>
      Number(r.sequence),
    );
    expect(sequences).toEqual([1, 2, 3, 4, 5]);
  });

  it('6. epoch semantics: idempotent runtime creation, message preservation on version rotation', async () => {
    const agentD = 'agent-def-epoch-1';
    const v1 = 'agent-version-v1-epoch';
    const v2 = 'agent-version-v2-epoch';

    // 6a: ensureChatRuntime is idempotent, epoch=1 on first and repeated calls
    const runtime1 = await repo.ensureChatRuntime({
      tenantId,
      agentDefinitionId: agentD,
      activeAgentVersionId: v1,
    });
    expect(runtime1.epoch).toBe(1);
    expect(runtime1.activeAgentVersionId).toBe(v1);
    expect(runtime1.status).toBe('available');

    const runtime1b = await repo.ensureChatRuntime({
      tenantId,
      agentDefinitionId: agentD,
      activeAgentVersionId: v1,
    });
    expect(runtime1b.epoch).toBe(1);
    expect(runtime1b.createdAt).toBe(runtime1.createdAt); // Not re-inserted
    expect(runtime1b.activeAgentVersionId).toBe(v1);

    // 6b: Create a conversation and append a message referencing v1
    const sa1 = 'sa-epoch-1';
    const conv = await repo.findOrCreateDirect({
      tenantId,
      principalId: sa1,
      principalType: 'service_account',
      agentDefinitionId: agentD,
    });

    const msg = await repo.appendMessage({
      author: {
        type: 'agent_definition',
        tenantId,
        conversationId: conv.id,
        agentDefinitionId: agentD,
        agentVersionId: v1,
        runtimeEpoch: 1,
      },
      body: 'Agent response v1',
    });
    expect(msg.agentVersionId).toBe(v1);
    expect(msg.runtimeEpoch).toBe(1);

    // 6c: Rotate the epoch to v2
    const runtime2 = await repo.rotateChatRuntimeEpoch({
      tenantId,
      agentDefinitionId: agentD,
      newVersionId: v2,
    });
    expect(runtime2.epoch).toBe(2);
    expect(runtime2.activeAgentVersionId).toBe(v2);

    // 6d: Verify the message from step 6b is NOT rewritten (history is immutable)
    const messages = await repo.listMessages({
      tenantId,
      conversationId: conv.id,
    });
    expect(messages.length).toBe(1);
    expect(messages[0]!.agentVersionId).toBe(v1); // Still v1, not rewritten to v2
    expect(messages[0]!.runtimeEpoch).toBe(1); // Still 1
  });

  it('7. tenant boundary: conversation in tenant A is not visible to tenant B', async () => {
    const sa1 = 'sa-tenant-boundary-1';
    const agentD = 'agent-def-tenant-boundary-1';

    // Create conversation in tenant A
    const convA = await repo.findOrCreateDirect({
      tenantId, // tenant A
      principalId: sa1,
      principalType: 'service_account',
      agentDefinitionId: agentD,
    });

    // Try to fetch it with the same conversation ID but different tenant (B)
    const convB = await repo.getConversation({
      tenantId: tenantIdT2, // tenant B
      conversationId: convA.id,
      requesterMemberType: 'principal',
      requesterMemberId: sa1,
    });

    expect(convB).toBeNull(); // Not found across tenant boundary
  });

  it('8. conversation_reads columns observed: markRead updates last_read_sequence and getUnread reflects it', async () => {
    const sa1 = 'sa-reads-1';
    const agentD = 'agent-def-reads-1';

    const conv = await repo.findOrCreateDirect({
      tenantId,
      principalId: sa1,
      principalType: 'service_account',
      agentDefinitionId: agentD,
    });

    // Append 3 messages
    await repo.appendMessage({
      author: principalAuthor(tenantId, conv.id, sa1),
      body: 'Message 1',
    });

    await repo.appendMessage({
      author: principalAuthor(tenantId, conv.id, sa1),
      body: 'Message 2',
    });

    await repo.appendMessage({
      author: principalAuthor(tenantId, conv.id, sa1),
      body: 'Message 3',
    });

    // Initially, no read marker exists; should show 3 unread
    let unread = await repo.getUnread({
      tenantId,
      conversationId: conv.id,
      principalType: 'service_account',
      principalId: sa1,
    });
    expect(unread.lastReadSequence).toBe(0);
    expect(unread.unreadCount).toBe(3);

    // Mark up to sequence 2
    await repo.markRead({
      tenantId,
      conversationId: conv.id,
      principalType: 'service_account',
      principalId: sa1,
      throughSequence: 2,
    });

    // Should show only 1 unread (sequence 3 after lastReadSequence 2)
    unread = await repo.getUnread({
      tenantId,
      conversationId: conv.id,
      principalType: 'service_account',
      principalId: sa1,
    });
    expect(unread.lastReadSequence).toBe(2);
    expect(unread.unreadCount).toBe(1);

    // Mark up to sequence 3
    await repo.markRead({
      tenantId,
      conversationId: conv.id,
      principalType: 'service_account',
      principalId: sa1,
      throughSequence: 3,
    });

    // Should show 0 unread
    unread = await repo.getUnread({
      tenantId,
      conversationId: conv.id,
      principalType: 'service_account',
      principalId: sa1,
    });
    expect(unread.lastReadSequence).toBe(3);
    expect(unread.unreadCount).toBe(0);
  });
});

describe('ChatActivationPlanner unit tests', () => {
  const planner = new ChatActivationPlanner();

  it('returns null when latest message author is agent_definition', () => {
    const result = planner.plan({
      agentDefinitionId: 'agent-1',
      conversationId: 'conv-1',
      lastReadSequence: 0,
      latestMessageSequence: 5,
      latestMessageAuthorType: 'agent_definition',
    });
    expect(result).toBeNull();
  });

  it('returns null when no unread messages (sequence <= lastRead)', () => {
    const result = planner.plan({
      agentDefinitionId: 'agent-1',
      conversationId: 'conv-1',
      lastReadSequence: 5,
      latestMessageSequence: 5,
      latestMessageAuthorType: 'principal',
    });
    expect(result).toBeNull();
  });

  it('returns ChatActivation when principal posts unread message', () => {
    const result = planner.plan({
      agentDefinitionId: 'agent-1',
      conversationId: 'conv-1',
      lastReadSequence: 3,
      latestMessageSequence: 5,
      latestMessageAuthorType: 'principal',
    });
    expect(result).not.toBeNull();
    expect(result?.agentDefinitionId).toBe('agent-1');
    expect(result?.priority).toBe('normal');
    expect(result?.dedupeKey).toBe('chat:agent-1:conv-1:5');
    expect(result?.causes).toHaveLength(1);
    expect(result?.causes[0]?.type).toBe('unread_message');
    expect(result?.causes[0]?.conversationId).toBe('conv-1');
    expect(result?.causes[0]?.throughSequence).toBe(5);
  });
});
