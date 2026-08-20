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
  claimed_by: string | null;
  claim_expires_at: string | Date | null;
  attempt_count: string | number;
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
      `SELECT * FROM chat_dispatches
       WHERE published_at IS NULL
         AND (claimed_by IS NULL OR claim_expires_at <= NOW())
       ORDER BY created_at ASC, id ASC LIMIT $1`,
      [limit],
    );
    return (result.rows ?? []).map(mapChatDispatch);
  }

  async claimNext(
    workerId: string,
    leaseMs: number,
  ): Promise<ChatDispatch | null> {
    const result = await this.database.query<ChatDispatchRow>(
      `WITH candidate AS (
         SELECT id
         FROM chat_dispatches
         WHERE published_at IS NULL
           AND (claimed_by IS NULL OR claim_expires_at <= NOW())
         ORDER BY created_at ASC, id ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE chat_dispatches AS dispatch
       SET claimed_by=$1,
           claim_expires_at=NOW() + ($2::bigint * INTERVAL '1 millisecond'),
           attempt_count=dispatch.attempt_count + 1
       FROM candidate
       WHERE dispatch.id=candidate.id
       RETURNING dispatch.*`,
      [workerId, leaseMs],
    );
    const row = result.rows?.[0];
    return row ? mapChatDispatch(row) : null;
  }

  async completeClaim(input: {
    readonly id: string;
    readonly workerId: string;
    readonly publishedAt: string;
  }): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE chat_dispatches
       SET published_at=$3, claimed_by=NULL, claim_expires_at=NULL
       WHERE id=$1
         AND claimed_by=$2
         AND published_at IS NULL
         AND claim_expires_at > NOW()`,
      [input.id, input.workerId, input.publishedAt],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async markPublished(id: string, publishedAt: string): Promise<void> {
    await this.database.query(
      `UPDATE chat_dispatches
       SET published_at=$2, claimed_by=NULL, claim_expires_at=NULL
       WHERE id=$1`,
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
