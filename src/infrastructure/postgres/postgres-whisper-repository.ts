import { randomUUID } from 'node:crypto';

import type {
  WhisperChannel,
  WhisperOrigin,
} from '../../domain/whisper/whisper-channel.js';
import { whisperPairKey } from '../../domain/whisper/whisper-channel.js';
import type { WhisperMessage } from '../../domain/whisper/whisper-message.js';
import type {
  OpenWhisperInput,
  WhisperRepository,
} from '../../application/ports/whisper-repository.js';
import type {
  PostgresClient,
  PostgresConnectable,
  PostgresQueryable,
} from './postgres-conversation-repository.js';

type WhisperChannelRow = {
  id: string;
  tenant_id: string;
  topic: string | null;
  next_sequence: string | number;
  created_at: string | Date;
  updated_at: string | Date;
  member_ids: (string | null)[] | null;
  origin_conversation_id: string | null;
  origin_message_id: string | null;
  work_ref: string | null;
  initiated_by_agent_definition_id: string | null;
};

type WhisperMessageRow = {
  id: string;
  tenant_id: string;
  conversation_id: string;
  sequence: string | number;
  author_id: string;
  body: string;
  created_at: string | Date;
};

const iso = () => new Date().toISOString();

const whisperChannelSelect = `
  SELECT c.id,
         c.tenant_id,
         c.topic,
         c.next_sequence,
         c.created_at,
         c.updated_at,
         COALESCE(
           array_agg(cm.member_id ORDER BY cm.member_id)
             FILTER (WHERE cm.member_id IS NOT NULL),
           ARRAY[]::text[]
         ) AS member_ids,
         o.origin_conversation_id,
         o.origin_message_id,
         o.work_ref,
         o.initiated_by_agent_definition_id
  FROM conversations c
  LEFT JOIN conversation_members cm
    ON cm.conversation_id = c.id
   AND cm.tenant_id = c.tenant_id
   AND cm.member_type = 'agent_definition'
  LEFT JOIN whisper_channel_origins o
    ON o.conversation_id = c.id
   AND o.tenant_id = c.tenant_id
  WHERE c.kind = 'whisper' AND c.tenant_id = $1`;

const whisperChannelGroupBy = `
  GROUP BY c.id, c.tenant_id, c.topic, c.next_sequence, c.created_at,
           c.updated_at, o.origin_conversation_id, o.origin_message_id,
           o.work_ref, o.initiated_by_agent_definition_id`;

export class PostgresWhisperRepository implements WhisperRepository {
  constructor(
    private readonly database: PostgresQueryable | PostgresConnectable,
  ) {}

  async openWhisper(input: OpenWhisperInput): Promise<{
    readonly channel: WhisperChannel;
    readonly message: WhisperMessage;
  }> {
    const memberIds = Object.freeze([
      input.initiatorAgentDefinitionId,
      ...input.partnerAgentDefinitionIds,
    ]);
    const pairKey = whisperPairKey(input.tenantId, memberIds);
    const now = iso();
    const attemptedConversationId = randomUUID();

    const client = await this.acquire();
    try {
      await client.query('BEGIN');

      const conversationResult = pairKey
        ? await client.query<{ id: string }>(
            `INSERT INTO conversations (id, tenant_id, kind, topic, direct_pair_key, next_sequence, created_at, updated_at)
             VALUES ($1, $2, 'whisper', $3, $4, 1, $5, $5)
             ON CONFLICT (tenant_id, direct_pair_key) WHERE direct_pair_key IS NOT NULL
             DO UPDATE SET updated_at = conversations.updated_at
             RETURNING id`,
            [
              attemptedConversationId,
              input.tenantId,
              input.topic ?? null,
              pairKey,
              now,
            ],
          )
        : await client.query<{ id: string }>(
            `INSERT INTO conversations (id, tenant_id, kind, topic, next_sequence, created_at, updated_at)
             VALUES ($1, $2, 'whisper', $3, 1, $4, $4)
             RETURNING id`,
            [attemptedConversationId, input.tenantId, input.topic ?? null, now],
          );

      const conversationId = conversationResult.rows?.[0]?.id;
      if (!conversationId) {
        throw new Error('Failed to open whisper channel.');
      }

      for (const memberId of memberIds) {
        await client.query(
          `INSERT INTO conversation_members (conversation_id, tenant_id, member_type, member_id, joined_at)
           VALUES ($1, $2, 'agent_definition', $3, $4)
           ON CONFLICT (conversation_id, member_type, member_id) DO NOTHING`,
          [conversationId, input.tenantId, memberId, now],
        );
      }

      await client.query(
        `INSERT INTO whisper_channel_origins
           (tenant_id, conversation_id, origin_conversation_id, origin_message_id, work_ref, initiated_by_agent_definition_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (tenant_id, conversation_id) DO NOTHING`,
        [
          input.tenantId,
          conversationId,
          input.origin?.conversationId ?? null,
          input.origin?.triggerMessageId ?? null,
          input.origin?.workRef ?? null,
          input.initiatorAgentDefinitionId,
          now,
        ],
      );

      const sequenceResult = await client.query<{
        next_sequence: string | number;
      }>(
        `SELECT next_sequence FROM conversations WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [conversationId, input.tenantId],
      );
      const sequenceRow = sequenceResult.rows?.[0];
      if (!sequenceRow) {
        throw new Error(
          'Failed to lock whisper channel for the opening message.',
        );
      }
      const sequence = Number(sequenceRow.next_sequence);
      const messageId = randomUUID();

      const messageResult = await client.query<WhisperMessageRow>(
        `INSERT INTO chat_messages
           (id, tenant_id, conversation_id, sequence, author_type, author_id, body, agent_definition_id, created_at)
         VALUES ($1, $2, $3, $4, 'agent_definition', $5, $6, $5, $7)
         RETURNING id, tenant_id, conversation_id, sequence, author_id, body, created_at`,
        [
          messageId,
          input.tenantId,
          conversationId,
          sequence,
          input.initiatorAgentDefinitionId,
          input.openingMessage,
          now,
        ],
      );
      const message = messageResult.rows?.[0];
      if (!message) {
        throw new Error('Failed to insert whisper opening message.');
      }

      await client.query(
        `UPDATE conversations SET next_sequence = next_sequence + 1, updated_at=$2
         WHERE id=$1 AND tenant_id=$3`,
        [conversationId, now, input.tenantId],
      );

      const channelResult = await client.query<WhisperChannelRow>(
        `${whisperChannelSelect} AND c.id = $2 ${whisperChannelGroupBy}`,
        [input.tenantId, conversationId],
      );
      const channelRow = channelResult.rows?.[0];
      if (!channelRow) {
        throw new Error('Failed to project the opened whisper channel.');
      }

      await client.query('COMMIT');
      return {
        channel: mapWhisperChannel(channelRow),
        message: mapWhisperMessage(message),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release?.();
    }
  }

  async sendWhisperMessage(input: {
    readonly tenantId: string;
    readonly whisperChannelId: string;
    readonly authorAgentDefinitionId: string;
    readonly body: string;
  }): Promise<WhisperMessage> {
    const client = await this.acquire();
    try {
      await client.query('BEGIN');

      const conversationResult = await client.query<{
        kind: string;
        next_sequence: string | number;
      }>(
        `SELECT kind, next_sequence FROM conversations
         WHERE id=$1 AND tenant_id=$2
         FOR UPDATE`,
        [input.whisperChannelId, input.tenantId],
      );
      const conversationRow = conversationResult.rows?.[0];
      if (!conversationRow || conversationRow.kind !== 'whisper') {
        throw new Error('Whisper channel not found.');
      }

      const memberResult = await client.query(
        `SELECT 1 FROM conversation_members
         WHERE conversation_id=$1 AND tenant_id=$2
           AND member_type='agent_definition' AND member_id=$3
         FOR KEY SHARE`,
        [input.whisperChannelId, input.tenantId, input.authorAgentDefinitionId],
      );
      if (!memberResult.rows?.[0]) {
        throw new Error('Message author is not a whisper channel member.');
      }

      const sequence = Number(conversationRow.next_sequence);
      const messageId = randomUUID();
      const now = iso();

      const messageResult = await client.query<WhisperMessageRow>(
        `INSERT INTO chat_messages
           (id, tenant_id, conversation_id, sequence, author_type, author_id, body, agent_definition_id, created_at)
         VALUES ($1, $2, $3, $4, 'agent_definition', $5, $6, $5, $7)
         RETURNING id, tenant_id, conversation_id, sequence, author_id, body, created_at`,
        [
          messageId,
          input.tenantId,
          input.whisperChannelId,
          sequence,
          input.authorAgentDefinitionId,
          input.body,
          now,
        ],
      );
      const message = messageResult.rows?.[0];
      if (!message) {
        throw new Error('Failed to insert whisper message.');
      }

      await client.query(
        `UPDATE conversations SET next_sequence = next_sequence + 1, updated_at=$2
         WHERE id=$1 AND tenant_id=$3`,
        [input.whisperChannelId, now, input.tenantId],
      );

      await client.query('COMMIT');
      return mapWhisperMessage(message);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release?.();
    }
  }

  async listAllWhisperChannels(input: {
    readonly tenantId: string;
  }): Promise<readonly WhisperChannel[]> {
    const result = await this.database.query<WhisperChannelRow>(
      `${whisperChannelSelect} ${whisperChannelGroupBy} ORDER BY c.updated_at DESC`,
      [input.tenantId],
    );
    return (result.rows ?? []).map(mapWhisperChannel);
  }

  async getWhisperChannel(input: {
    readonly tenantId: string;
    readonly whisperChannelId: string;
  }): Promise<WhisperChannel | null> {
    const result = await this.database.query<WhisperChannelRow>(
      `${whisperChannelSelect} AND c.id = $2 ${whisperChannelGroupBy}`,
      [input.tenantId, input.whisperChannelId],
    );
    const row = result.rows?.[0];
    return row ? mapWhisperChannel(row) : null;
  }

  async listWhisperMessages(input: {
    readonly tenantId: string;
    readonly whisperChannelId: string;
  }): Promise<readonly WhisperMessage[]> {
    const channel = await this.getWhisperChannel(input);
    if (!channel) return [];
    const result = await this.database.query<WhisperMessageRow>(
      `SELECT id, tenant_id, conversation_id, sequence, author_id, body, created_at
       FROM chat_messages
       WHERE conversation_id=$1 AND tenant_id=$2
       ORDER BY sequence ASC`,
      [input.whisperChannelId, input.tenantId],
    );
    return (result.rows ?? []).map(mapWhisperMessage);
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

function mapWhisperChannel(row: WhisperChannelRow): WhisperChannel {
  const origin: WhisperOrigin = Object.freeze({
    conversationId: row.origin_conversation_id ?? null,
    triggerMessageId: row.origin_message_id ?? null,
    workRef: row.work_ref ?? null,
  });
  return Object.freeze({
    id: row.id,
    tenantId: row.tenant_id,
    topic: row.topic ?? null,
    memberAgentDefinitionIds: Object.freeze(
      (row.member_ids ?? []).filter((id): id is string => id !== null),
    ),
    initiatedByAgentDefinitionId: row.initiated_by_agent_definition_id ?? '',
    origin,
    nextSequence: Number(row.next_sequence),
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
  });
}

function mapWhisperMessage(row: WhisperMessageRow): WhisperMessage {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenant_id,
    whisperChannelId: row.conversation_id,
    sequence: Number(row.sequence),
    authorAgentDefinitionId: row.author_id,
    body: row.body,
    createdAt: isoDate(row.created_at),
  });
}

function isoDate(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
