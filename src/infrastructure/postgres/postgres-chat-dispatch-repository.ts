import type {
  ChatDispatch,
  ChatDispatchRepository,
} from '../../application/ports/chat-dispatch-repository.js';
import type { PostgresQueryable } from './postgres-conversation-repository.js';

type ChatDispatchRow = {
  id: string | number;
  tenant_id: string;
  agent_definition_id: string;
  conversation_id: string;
  through_sequence: string | number;
  dedupe_key: string;
  created_at: string | Date;
  published_at: string | Date | null;
};

const iso_date = (value: string | Date | null | undefined): string | null => {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
};

export class PostgresChatDispatchRepository implements ChatDispatchRepository {
  constructor(private readonly database: PostgresQueryable) {}

  async enqueue(input: {
    readonly tenantId: string;
    readonly agentDefinitionId: string;
    readonly conversationId: string;
    readonly throughSequence: number;
    readonly dedupeKey: string;
  }): Promise<{ readonly enqueued: boolean }> {
    const createdAt = new Date().toISOString();
    const result = await this.database.query(
      `INSERT INTO chat_dispatches (tenant_id, agent_definition_id, conversation_id, through_sequence, dedupe_key, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        input.tenantId,
        input.agentDefinitionId,
        input.conversationId,
        input.throughSequence,
        input.dedupeKey,
        createdAt,
      ],
    );
    return { enqueued: (result.rowCount ?? 0) > 0 };
  }

  async listPending(limit: number): Promise<readonly ChatDispatch[]> {
    const result = await this.database.query<ChatDispatchRow>(
      `SELECT * FROM chat_dispatches WHERE published_at IS NULL ORDER BY created_at ASC, id ASC LIMIT $1`,
      [limit],
    );
    return (result.rows ?? []).map(mapChatDispatch);
  }

  async markPublished(id: string, publishedAt: string): Promise<void> {
    await this.database.query(
      `UPDATE chat_dispatches SET published_at=$2 WHERE id=$1`,
      [id, publishedAt],
    );
  }
}

function mapChatDispatch(row: ChatDispatchRow): ChatDispatch {
  return Object.freeze({
    id: String(row.id),
    tenantId: row.tenant_id,
    agentDefinitionId: row.agent_definition_id,
    conversationId: row.conversation_id,
    throughSequence: Number(row.through_sequence),
    dedupeKey: row.dedupe_key,
    createdAt: iso_date(row.created_at)!,
    publishedAt: iso_date(row.published_at),
  });
}
