import { randomUUID } from 'node:crypto';
import type {
  Conversation,
  ConversationMember,
} from '../../domain/chat/conversation.js';
import {
  assertDirectConversationInvariant,
  directPairKey,
} from '../../domain/chat/conversation.js';
import type { ChatMessage } from '../../domain/chat/chat-message.js';
import type { AgentChatRuntime } from '../../domain/chat/agent-chat-runtime.js';
import type {
  ConversationMessageAuthorContext,
  ConversationRepository,
} from '../../application/ports/conversation-repository.js';

export interface PostgresQueryable {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{
    readonly rows?: readonly Row[];
    readonly rowCount?: number | null;
  }>;
}

export interface PostgresConnectable extends PostgresQueryable {
  connect(): Promise<PostgresClient>;
}

export interface PostgresClient extends PostgresQueryable {
  release(): void;
}

type ConversationRow = {
  id: string;
  tenant_id: string;
  kind: string;
  title: string | null;
  topic: string | null;
  direct_pair_key: string | null;
  next_sequence: string | number;
  created_at: string | Date;
  updated_at: string | Date;
  direct_agent_peer_count: string | number | null;
  direct_agent_definition_id: string | null;
  direct_agent_display_name: string | null;
};

type ConversationMemberRow = {
  conversation_id: string;
  tenant_id: string;
  member_type: string;
  member_id: string;
  member_principal_type: string | null;
  role: string | null;
  joined_at: string | Date;
};

type ChatMessageRow = {
  id: string;
  tenant_id: string;
  conversation_id: string;
  sequence: string | number;
  author_type: string;
  author_id: string;
  body: string;
  agent_definition_id: string | null;
  agent_version_id: string | null;
  runtime_epoch: number | null;
  provider: string | null;
  work_ref: string | null;
  delivery_id: string | null;
  created_at: string | Date;
};

type ConversationReadRow = {
  conversation_id: string;
  principal_type: string;
  principal_id: string;
  last_read_sequence: string | number;
  updated_at: string | Date;
};

type AgentChatRuntimeRow = {
  id: string;
  tenant_id: string;
  agent_definition_id: string;
  active_agent_version_id: string;
  epoch: number;
  status: string;
  last_active_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

const iso = () => new Date().toISOString();

const conversationSelectColumns = `
         c.id,
         c.tenant_id,
         c.kind,
         c.title,
         c.topic,
         c.direct_pair_key,
         c.next_sequence,
         c.created_at,
         c.updated_at,
         direct_agent_peer.agent_peer_count AS direct_agent_peer_count,
         CASE
           WHEN c.kind = 'direct' AND direct_agent_peer.agent_peer_count = 1
           THEN direct_agent_peer.member_id
           ELSE NULL
         END AS direct_agent_definition_id,
         CASE
           WHEN c.kind = 'direct' AND direct_agent_peer.agent_peer_count = 1
           THEN ad.name
           ELSE NULL
         END AS direct_agent_display_name`;

const conversationJoins = `
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*)::int AS agent_peer_count,
           CASE WHEN COUNT(*) = 1 THEN MAX(cm.member_id) ELSE NULL END AS member_id
         FROM conversation_members cm
         WHERE cm.conversation_id = c.id
           AND cm.tenant_id = c.tenant_id
           AND cm.member_type = 'agent_definition'
       ) direct_agent_peer ON TRUE
       LEFT JOIN agent_definitions ad
         ON ad.tenant_id = c.tenant_id
        AND c.kind = 'direct'
        AND direct_agent_peer.agent_peer_count = 1
        AND ad.id::text = direct_agent_peer.member_id`;

export class PostgresConversationRepository implements ConversationRepository {
  constructor(
    private readonly database: PostgresQueryable | PostgresConnectable,
  ) {}

  async findOrCreateDirect(input: {
    readonly tenantId: string;
    readonly principalId: string;
    readonly principalType: string;
    readonly agentDefinitionId: string;
  }): Promise<Conversation> {
    const key = directPairKey(
      input.tenantId,
      input.principalId,
      input.agentDefinitionId,
    );
    const now = iso();
    const conversationId = randomUUID();

    const client = await this.acquire();
    try {
      await client.query('BEGIN');

      const conversationResult = await client.query<ConversationRow>(
        `INSERT INTO conversations (id, tenant_id, kind, direct_pair_key, next_sequence, created_at, updated_at)
         VALUES ($1, $2, 'direct', $3, 1, $4, $5)
         ON CONFLICT (tenant_id, direct_pair_key) WHERE direct_pair_key IS NOT NULL
         DO UPDATE SET updated_at = conversations.updated_at
         RETURNING id, tenant_id, kind, title, topic, direct_pair_key, next_sequence, created_at, updated_at`,
        [conversationId, input.tenantId, key, now, now],
      );

      const conversation = conversationResult.rows?.[0];
      if (!conversation) {
        throw new Error('Failed to create or retrieve direct conversation.');
      }

      const actualConversationId = conversation.id;

      await client.query(
        `INSERT INTO conversation_members (conversation_id, tenant_id, member_type, member_id, member_principal_type, joined_at)
         VALUES ($1, $2, 'principal', $3, $4, $5)
         ON CONFLICT (conversation_id, member_type, member_id) DO NOTHING`,
        [
          actualConversationId,
          input.tenantId,
          input.principalId,
          input.principalType,
          now,
        ],
      );

      await client.query(
        `INSERT INTO conversation_members (conversation_id, tenant_id, member_type, member_id, joined_at)
         VALUES ($1, $2, 'agent_definition', $3, $4)
         ON CONFLICT (conversation_id, member_type, member_id) DO NOTHING`,
        [actualConversationId, input.tenantId, input.agentDefinitionId, now],
      );

      const projectedConversationResult = await client.query<ConversationRow>(
        `SELECT ${conversationSelectColumns}
         FROM conversations c
         ${conversationJoins}
         WHERE c.id=$1 AND c.tenant_id=$2`,
        [actualConversationId, input.tenantId],
      );
      const projectedConversation = projectedConversationResult.rows?.[0];
      if (!projectedConversation) {
        throw new Error('Failed to project direct conversation.');
      }

      await client.query('COMMIT');
      return mapConversation(projectedConversation);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release?.();
    }
  }

  async getConversation(input: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly requesterMemberType: 'principal' | 'agent_definition';
    readonly requesterMemberId: string;
  }): Promise<Conversation | null> {
    const membershipResult = await this.database.query<ConversationMemberRow>(
      `SELECT conversation_id, tenant_id, member_type, member_id,
              member_principal_type, role, joined_at
       FROM conversation_members
       WHERE conversation_id=$1 AND tenant_id=$2 AND member_type=$3 AND member_id=$4`,
      [
        input.conversationId,
        input.tenantId,
        input.requesterMemberType,
        input.requesterMemberId,
      ],
    );

    if (!membershipResult.rows?.[0]) return null;

    const conversationResult = await this.database.query<ConversationRow>(
      `SELECT ${conversationSelectColumns}
       FROM conversations c
       ${conversationJoins}
         WHERE c.id=$1 AND c.tenant_id=$2`,
      [input.conversationId, input.tenantId],
    );

    return conversationResult.rows?.[0]
      ? mapConversation(conversationResult.rows[0])
      : null;
  }

  async listConversations(input: {
    readonly tenantId: string;
    readonly memberType: 'principal' | 'agent_definition';
    readonly memberId: string;
  }): Promise<readonly Conversation[]> {
    const result = await this.database.query<ConversationRow>(
      `SELECT ${conversationSelectColumns}
       FROM conversations c
       ${conversationJoins}
       JOIN conversation_members m ON m.conversation_id = c.id
       WHERE c.tenant_id=$1 AND m.tenant_id=$1 AND m.member_type=$2 AND m.member_id=$3
       ORDER BY c.updated_at DESC`,
      [input.tenantId, input.memberType, input.memberId],
    );

    return (result.rows ?? []).map(mapConversation);
  }

  async findPrincipalMember(input: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly principalId: string;
  }): Promise<ConversationMember | null> {
    const result = await this.database.query<ConversationMemberRow>(
      `SELECT conversation_id,tenant_id,member_type,member_id,
              member_principal_type,role,joined_at
         FROM conversation_members
        WHERE tenant_id=$1 AND conversation_id=$2
          AND member_type='principal' AND member_id=$3
        LIMIT 2`,
      [input.tenantId, input.conversationId, input.principalId],
    );
    if ((result.rows?.length ?? 0) > 1)
      throw new Error('Conversation principal membership is ambiguous.');
    return result.rows?.[0] ? mapConversationMember(result.rows[0]) : null;
  }

  async appendMessage(input: {
    readonly author: ConversationMessageAuthorContext;
    readonly body: string;
    readonly workRef?: string | null;
    readonly deliveryId?: string | null;
  }): Promise<ChatMessage> {
    const authorType = input.author.type;
    const authorId =
      authorType === 'principal'
        ? input.author.principalId
        : input.author.agentDefinitionId;
    const agentDefinitionId =
      authorType === 'agent_definition'
        ? input.author.agentDefinitionId
        : null;
    const agentVersionId =
      authorType === 'agent_definition'
        ? (input.author.agentVersionId ?? null)
        : null;
    const runtimeEpoch =
      authorType === 'agent_definition'
        ? (input.author.runtimeEpoch ?? null)
        : null;
    const provider =
      authorType === 'agent_definition'
        ? (input.author.provider ?? null)
        : null;

    const client = await this.acquire();
    try {
      await client.query('BEGIN');

      const conversationLockResult = await client.query<ConversationRow>(
        `SELECT next_sequence FROM conversations
         WHERE id=$1 AND tenant_id=$2
         FOR UPDATE`,
        [input.author.conversationId, input.author.tenantId],
      );

      const conversationRow = conversationLockResult.rows?.[0];
      if (!conversationRow) {
        throw new Error('Conversation not found or access denied.');
      }

      const memberResult = await client.query<ConversationMemberRow>(
        `SELECT conversation_id, tenant_id, member_type, member_id,
                member_principal_type, role, joined_at
         FROM conversation_members
         WHERE conversation_id=$1 AND tenant_id=$2 AND member_type=$3 AND member_id=$4
         FOR KEY SHARE`,
        [
          input.author.conversationId,
          input.author.tenantId,
          authorType,
          authorId,
        ],
      );
      const member = memberResult.rows?.[0];
      if (!member) {
        throw new Error('Message author is not a conversation member.');
      }

      if (
        authorType === 'agent_definition' &&
        (member.member_type !== 'agent_definition' ||
          member.member_id !== input.author.agentDefinitionId)
      ) {
        throw new Error('Agent message author does not match its definition.');
      }

      if (
        authorType === 'principal' &&
        member.member_principal_type !== input.author.principalType
      ) {
        throw new Error('Principal message author type does not match membership.');
      }

      const sequence = Number(conversationRow.next_sequence);
      const messageId = randomUUID();
      const now = iso();

      const hasDeliveryId =
        input.deliveryId !== undefined && input.deliveryId !== null;
      const messageResult = hasDeliveryId
        ? await client.query<ChatMessageRow>(
            `INSERT INTO chat_messages
             (id, tenant_id, conversation_id, sequence, author_type, author_id, body, agent_definition_id, agent_version_id, runtime_epoch, provider, work_ref, delivery_id, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             ON CONFLICT (tenant_id, conversation_id, delivery_id)
             WHERE delivery_id IS NOT NULL DO NOTHING
             RETURNING *`,
            [
              messageId,
              input.author.tenantId,
              input.author.conversationId,
              sequence,
              authorType,
              authorId,
              input.body,
              agentDefinitionId,
              agentVersionId,
              runtimeEpoch,
              provider,
              input.workRef ?? null,
              input.deliveryId,
              now,
            ],
          )
        : await client.query<ChatMessageRow>(
            `INSERT INTO chat_messages
             (id, tenant_id, conversation_id, sequence, author_type, author_id, body, agent_definition_id, agent_version_id, runtime_epoch, provider, work_ref, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
             RETURNING *`,
            [
              messageId,
              input.author.tenantId,
              input.author.conversationId,
              sequence,
              authorType,
              authorId,
              input.body,
              agentDefinitionId,
              agentVersionId,
              runtimeEpoch,
              provider,
              input.workRef ?? null,
              now,
            ],
          );

      let message = messageResult.rows?.[0];
      if (!message && hasDeliveryId) {
        const existing = await client.query<ChatMessageRow>(
          `SELECT * FROM chat_messages
           WHERE tenant_id=$1 AND conversation_id=$2 AND delivery_id=$3`,
          [
            input.author.tenantId,
            input.author.conversationId,
            input.deliveryId,
          ],
        );
        message = existing.rows?.[0];
      }
      if (!message) {
        throw new Error('Failed to insert chat message.');
      }

      if (!messageResult.rows?.[0]) {
        await client.query('COMMIT');
        return mapChatMessage(message);
      }

      await client.query(
        `UPDATE conversations SET next_sequence=next_sequence+1, updated_at=$2
         WHERE id=$1 AND tenant_id=$3`,
        [input.author.conversationId, now, input.author.tenantId],
      );

      await client.query('COMMIT');
      return mapChatMessage(message);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release?.();
    }
  }

  async listMessages(input: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly afterSequence?: number;
  }): Promise<readonly ChatMessage[]> {
    const afterSeq = input.afterSequence ?? 0;
    const result = await this.database.query<ChatMessageRow>(
      `SELECT * FROM chat_messages
       WHERE conversation_id=$1 AND tenant_id=$2 AND sequence > $3
       ORDER BY sequence ASC`,
      [input.conversationId, input.tenantId, afterSeq],
    );

    return (result.rows ?? []).map(mapChatMessage);
  }

  async getUnread(input: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly principalType: string;
    readonly principalId: string;
  }): Promise<{ readonly lastReadSequence: number; readonly unreadCount: number }> {
    const readResult = await this.database.query<ConversationReadRow>(
      `SELECT last_read_sequence FROM conversation_reads
       WHERE conversation_id=$1 AND principal_type=$2 AND principal_id=$3`,
      [input.conversationId, input.principalType, input.principalId],
    );

    const lastReadSequence = readResult.rows?.[0]
      ? Number(readResult.rows[0].last_read_sequence)
      : 0;

    const countResult = await this.database.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM chat_messages
       WHERE conversation_id=$1 AND tenant_id=$2 AND sequence > $3`,
      [input.conversationId, input.tenantId, lastReadSequence],
    );

    const unreadCount = countResult.rows?.[0]
      ? Number(countResult.rows[0].count)
      : 0;

    return { lastReadSequence, unreadCount };
  }

  async markRead(input: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly principalType: string;
    readonly principalId: string;
    readonly throughSequence: number;
  }): Promise<void> {
    const now = iso();
    await this.database.query(
      `INSERT INTO conversation_reads (conversation_id, principal_type, principal_id, last_read_sequence, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (conversation_id, principal_type, principal_id)
       DO UPDATE SET last_read_sequence = GREATEST(conversation_reads.last_read_sequence, $4), updated_at = $5`,
      [
        input.conversationId,
        input.principalType,
        input.principalId,
        input.throughSequence,
        now,
      ],
    );
  }

  async ensureChatRuntime(input: {
    readonly tenantId: string;
    readonly agentDefinitionId: string;
    readonly activeAgentVersionId: string;
  }): Promise<AgentChatRuntime> {
    const now = iso();
    const result = await this.database.query<AgentChatRuntimeRow>(
      `INSERT INTO agent_chat_runtimes (tenant_id, agent_definition_id, active_agent_version_id, epoch, status, created_at, updated_at)
       VALUES ($1, $2, $3, 1, 'available', $4, $5)
       ON CONFLICT (tenant_id, agent_definition_id)
       DO UPDATE SET updated_at = agent_chat_runtimes.updated_at
       RETURNING *`,
      [
        input.tenantId,
        input.agentDefinitionId,
        input.activeAgentVersionId,
        now,
        now,
      ],
    );

    const runtime = result.rows?.[0];
    if (!runtime) {
      throw new Error('Failed to ensure agent chat runtime.');
    }

    return mapAgentChatRuntime(runtime);
  }

  async rotateChatRuntimeEpoch(input: {
    readonly tenantId: string;
    readonly agentDefinitionId: string;
    readonly newVersionId: string;
  }): Promise<AgentChatRuntime> {
    const now = iso();
    const result = await this.database.query<AgentChatRuntimeRow>(
      `UPDATE agent_chat_runtimes
       SET active_agent_version_id=$3, epoch=epoch+1, updated_at=$4
       WHERE tenant_id=$1 AND agent_definition_id=$2
       RETURNING *`,
      [input.tenantId, input.agentDefinitionId, input.newVersionId, now],
    );

    const runtime = result.rows?.[0];
    if (!runtime) {
      throw new Error('Agent chat runtime not found.');
    }

    return mapAgentChatRuntime(runtime);
  }

  async getChatRuntime(input: {
    readonly tenantId: string;
    readonly agentDefinitionId: string;
  }): Promise<AgentChatRuntime | null> {
    const result = await this.database.query<AgentChatRuntimeRow>(
      `SELECT * FROM agent_chat_runtimes WHERE tenant_id=$1 AND agent_definition_id=$2`,
      [input.tenantId, input.agentDefinitionId],
    );
    const row = result.rows?.[0];
    return row ? mapAgentChatRuntime(row) : null;
  }

  private async acquire(): Promise<PostgresClient> {
    if (
      'connect' in this.database &&
      typeof this.database.connect === 'function'
    ) {
      return await (this.database as PostgresConnectable).connect();
    }
    return this.database as PostgresClient;
  }
}

function mapConversation(row: ConversationRow): Conversation {
  const directAgentPeerCount = Number(row.direct_agent_peer_count ?? 0);
  if (row.kind === 'direct' && directAgentPeerCount > 1) {
    throw new Error('Direct conversation has multiple agent_definition peers.');
  }
  const directAgent =
    row.kind === 'direct' &&
    directAgentPeerCount === 1 &&
    row.direct_agent_definition_id
      ? {
          agentDefinitionId: row.direct_agent_definition_id,
          displayName: row.direct_agent_display_name ?? null,
        }
      : null;
  return Object.freeze({
    id: row.id,
    tenantId: row.tenant_id,
    kind: row.kind as 'direct' | 'group',
    title: row.title ?? null,
    directAgent,
    topic: row.topic ?? null,
    directPairKey: row.direct_pair_key ?? null,
    nextSequence: Number(row.next_sequence),
    createdAt: iso_date(row.created_at),
    updatedAt: iso_date(row.updated_at),
  });
}

function mapConversationMember(row: ConversationMemberRow): ConversationMember {
  return Object.freeze({
    conversationId: row.conversation_id,
    tenantId: row.tenant_id,
    memberType: row.member_type as 'principal' | 'agent_definition',
    memberId: row.member_id,
    memberPrincipalType: row.member_principal_type ?? null,
    role: row.role ?? null,
    joinedAt: iso_date(row.joined_at),
  });
}

function mapChatMessage(row: ChatMessageRow): ChatMessage {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenant_id,
    conversationId: row.conversation_id,
    sequence: Number(row.sequence),
    authorType: row.author_type as 'principal' | 'agent_definition',
    authorId: row.author_id,
    body: row.body,
    agentDefinitionId: row.agent_definition_id ?? null,
    agentVersionId: row.agent_version_id ?? null,
    runtimeEpoch: row.runtime_epoch ?? null,
    provider: row.provider ?? null,
    workRef: row.work_ref ?? null,
    deliveryId: row.delivery_id ?? null,
    createdAt: iso_date(row.created_at),
  });
}

function mapAgentChatRuntime(row: AgentChatRuntimeRow): AgentChatRuntime {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenant_id,
    agentDefinitionId: row.agent_definition_id,
    activeAgentVersionId: row.active_agent_version_id,
    epoch: row.epoch,
    status: row.status as 'available' | 'draining' | 'unavailable',
    lastActiveAt: row.last_active_at ? iso_date(row.last_active_at) : null,
    createdAt: iso_date(row.created_at),
    updatedAt: iso_date(row.updated_at),
  });
}

function iso_date(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
