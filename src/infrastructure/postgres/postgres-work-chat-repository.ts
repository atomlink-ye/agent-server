import { randomUUID } from 'node:crypto';
import type {
  WorkChatClaim,
  WorkChatOwner,
  WorkChatRepository,
} from '../../application/ports/work-chat-repository.js';
import type {
  WorkChatMessage,
  WorkChatMessageKind,
  WorkChatMessageStatus,
} from '../../domain/work/work-chat-message.js';

interface Queryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{
    readonly rows?: readonly Row[];
    readonly rowCount?: number | null;
  }>;
}
interface Client extends Queryable {
  release(): void;
}
interface Connectable extends Queryable {
  connect(): Promise<Client>;
}
type Database = Queryable | Connectable;

interface Row extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  workspace_id: string;
  work_id: string;
  preparation_id: string | null;
  work_run_id: string | null;
  sequence: number | string;
  kind: WorkChatMessageKind;
  body: string;
  status: WorkChatMessageStatus;
  reply_to_message_id: string | null;
  client_request_id: string | null;
  lease_owner: string | null;
  lease_fence: number | string;
  lease_expires_at: string | Date | null;
  attempt_count: number | string;
  source_runtime_turn_id: string | null;
  failure_code: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

const COLUMNS = `id,tenant_id,workspace_id,work_id,preparation_id,work_run_id,sequence,kind,body,status,
 reply_to_message_id,client_request_id,lease_owner,lease_fence,lease_expires_at,
 attempt_count,source_runtime_turn_id,failure_code,created_at,updated_at`;

export class PostgresWorkChatRepository implements WorkChatRepository {
  public constructor(private readonly database: Database) {}

  public async list(input: {
    owner: WorkChatOwner;
    workId: string;
    limit?: number;
  }) {
    const result = await this.database.query<Row>(
      `SELECT * FROM (
         SELECT ${COLUMNS} FROM work_chat_messages
          WHERE tenant_id=$1 AND workspace_id=$2 AND work_id=$3
          ORDER BY sequence DESC LIMIT $4
       ) latest ORDER BY sequence ASC`,
      [
        input.owner.tenantId,
        input.owner.workspaceId,
        input.workId,
        Math.min(input.limit ?? 200, 500),
      ],
    );
    return (result.rows ?? []).map(mapRow);
  }

  public async enqueue(input: {
    owner: WorkChatOwner;
    workId: string;
    id: string;
    body: string;
    clientRequestId: string;
    createdAt: string;
  }) {
    const client = await this.transactionClient();
    try {
      await client.query('BEGIN');
      const existing = await client.query<Row>(
        `SELECT ${COLUMNS} FROM work_chat_messages
          WHERE tenant_id=$1 AND workspace_id=$2 AND work_id=$3 AND client_request_id=$4
          FOR UPDATE`,
        [
          input.owner.tenantId,
          input.owner.workspaceId,
          input.workId,
          input.clientRequestId,
        ],
      );
      if (existing.rows?.[0]) {
        await client.query('COMMIT');
        return { message: mapRow(existing.rows[0]), replayed: true };
      }
      await client.query(
        `SELECT id FROM works WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3 FOR UPDATE`,
        [input.workId, input.owner.tenantId, input.owner.workspaceId],
      );
      // Re-check after the Work-row lock: concurrent requests with the same
      // client key may have observed no row before waiting for this lock.
      const afterLock = await client.query<Row>(
        `SELECT ${COLUMNS} FROM work_chat_messages
          WHERE tenant_id=$1 AND workspace_id=$2 AND work_id=$3 AND client_request_id=$4
          FOR UPDATE`,
        [
          input.owner.tenantId,
          input.owner.workspaceId,
          input.workId,
          input.clientRequestId,
        ],
      );
      if (afterLock.rows?.[0]) {
        await client.query('COMMIT');
        return { message: mapRow(afterLock.rows[0]), replayed: true };
      }
      const sequence = await client.query<{ next_sequence: string }>(
        `SELECT COALESCE(MAX(sequence),0)+1 AS next_sequence
           FROM work_chat_messages WHERE tenant_id=$1 AND workspace_id=$2 AND work_id=$3`,
        [input.owner.tenantId, input.owner.workspaceId, input.workId],
      );
      const result = await client.query<Row>(
        `INSERT INTO work_chat_messages
          (id,tenant_id,workspace_id,work_id,sequence,kind,body,status,
           client_request_id,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,'user',$6,'queued',$7,$8,$8)
         RETURNING ${COLUMNS}`,
        [
          input.id,
          input.owner.tenantId,
          input.owner.workspaceId,
          input.workId,
          Number(sequence.rows?.[0]?.next_sequence ?? 1),
          input.body,
          input.clientRequestId,
          input.createdAt,
        ],
      );
      const row = result.rows?.[0];
      if (!row) throw new Error('Work Chat message could not be created.');
      await client.query('COMMIT');
      return { message: mapRow(row), replayed: false };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async claimNext(input: {
    workerId: string;
    leaseMs: number;
    now: string;
  }): Promise<WorkChatClaim | null> {
    const client = await this.transactionClient();
    try {
      await client.query('BEGIN');
      const result = await client.query<Row>(
        `SELECT ${COLUMNS} FROM work_chat_messages
          WHERE kind='user' AND NOT EXISTS (
            SELECT 1 FROM work_chat_messages busy
             WHERE busy.tenant_id=work_chat_messages.tenant_id
               AND busy.workspace_id=work_chat_messages.workspace_id
               AND busy.work_id=work_chat_messages.work_id
               AND busy.id<>work_chat_messages.id
               AND busy.kind='user' AND busy.status='processing'
               AND busy.lease_expires_at >= $1
          ) AND (
            status='queued' OR (status='processing' AND lease_expires_at < $1)
          )
          ORDER BY created_at ASC, sequence ASC
          LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [input.now],
      );
      const row = result.rows?.[0];
      if (!row) {
        await client.query('COMMIT');
        return null;
      }
      await client.query(
        `SELECT id FROM works WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3 FOR UPDATE`,
        [row.work_id, row.tenant_id, row.workspace_id],
      );
      const busy = await client.query(
        `SELECT id FROM work_chat_messages
          WHERE tenant_id=$1 AND workspace_id=$2 AND work_id=$3
            AND kind='user' AND status='processing' AND id<>$4
            AND lease_expires_at >= $5
          LIMIT 1`,
        [row.tenant_id, row.workspace_id, row.work_id, row.id, input.now],
      );
      if ((busy.rows?.length ?? 0) > 0) {
        await client.query('COMMIT');
        return null;
      }
      const updated = await client.query<Row>(
        `UPDATE work_chat_messages SET status='processing',lease_owner=$2,
           lease_fence=lease_fence+1,lease_expires_at=$3,
           attempt_count=attempt_count+1,updated_at=$1
         WHERE id=$4 RETURNING ${COLUMNS}`,
        [
          input.now,
          input.workerId,
          new Date(new Date(input.now).getTime() + input.leaseMs).toISOString(),
          row.id,
        ],
      );
      await client.query('COMMIT');
      const claimed = updated.rows?.[0];
      return claimed ? (mapRow(claimed) as WorkChatClaim) : null;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async complete(input: Parameters<WorkChatRepository['complete']>[0]) {
    const client = await this.transactionClient();
    try {
      await client.query('BEGIN');
      const locked = await client.query<Row>(
        `SELECT ${COLUMNS} FROM work_chat_messages
          WHERE id=$1 AND kind='user' AND status='processing'
            AND lease_owner=$2 AND lease_fence=$3 AND lease_expires_at > $4 FOR UPDATE`,
        [input.id, input.workerId, input.leaseFence, input.updatedAt],
      );
      const user = locked.rows?.[0];
      if (!user) {
        await client.query('ROLLBACK');
        return false;
      }
      await client.query(
        `SELECT id FROM works WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3 FOR UPDATE`,
        [user.work_id, user.tenant_id, user.workspace_id],
      );
      const existingReply = await client.query<Row>(
        `SELECT ${COLUMNS} FROM work_chat_messages
          WHERE kind='lead' AND (reply_to_message_id=$1 OR source_runtime_turn_id=$2)
          FOR UPDATE`,
        [input.id, input.reply.sourceRuntimeTurnId],
      );
      if (existingReply.rows?.[0]) {
        const updated = await client.query<Row>(
          `UPDATE work_chat_messages SET status='replied',lease_owner=NULL,
            lease_expires_at=NULL,updated_at=$1
           WHERE id=$2 AND status='processing' AND lease_owner=$3 AND lease_fence=$4
           RETURNING ${COLUMNS}`,
          [input.updatedAt, input.id, input.workerId, input.leaseFence],
        );
        await client.query('COMMIT');
        return updated.rows?.[0] ? mapRow(updated.rows[0]) : false;
      }
      const sequence = await client.query<{ next_sequence: string }>(
        `SELECT COALESCE(MAX(sequence),0)+1 AS next_sequence FROM work_chat_messages
          WHERE tenant_id=$1 AND workspace_id=$2 AND work_id=$3`,
        [user.tenant_id, user.workspace_id, user.work_id],
      );
      await client.query(
        `INSERT INTO work_chat_messages
          (id,tenant_id,workspace_id,work_id,sequence,kind,body,status,
           reply_to_message_id,source_runtime_turn_id,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,'lead',$6,'replied',$7,$8,$9,$9)
         ON CONFLICT (id) DO NOTHING`,
        [
          input.reply.id,
          user.tenant_id,
          user.workspace_id,
          user.work_id,
          Number(sequence.rows?.[0]?.next_sequence ?? 1),
          input.reply.body,
          input.id,
          input.reply.sourceRuntimeTurnId,
          input.reply.createdAt,
        ],
      );
      const updated = await client.query<Row>(
        `UPDATE work_chat_messages SET status='replied',lease_owner=NULL,
          lease_expires_at=NULL,updated_at=$1 WHERE id=$2 AND status='processing'
          AND lease_owner=$3 AND lease_fence=$4 AND lease_expires_at > $1
          RETURNING ${COLUMNS}`,
        [input.updatedAt, input.id, input.workerId, input.leaseFence],
      );
      await client.query('COMMIT');
      return updated.rows?.[0] ? mapRow(updated.rows[0]) : false;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async fail(input: Parameters<WorkChatRepository['fail']>[0]) {
    const result = await this.database.query<Row>(
      `UPDATE work_chat_messages SET status='failed',failure_code=$4,
         lease_owner=NULL,lease_expires_at=NULL,updated_at=$5
       WHERE id=$1 AND kind='user' AND lease_owner=$2 AND lease_fence=$3
       RETURNING ${COLUMNS}`,
      [
        input.id,
        input.workerId,
        input.leaseFence,
        input.failureCode,
        input.updatedAt,
      ],
    );
    return result.rows?.[0] ? mapRow(result.rows[0]) : false;
  }

  public async retry(input: Parameters<WorkChatRepository['retry']>[0]) {
    const result = await this.database.query<Row>(
      `UPDATE work_chat_messages SET status='queued',failure_code=NULL,
         lease_owner=NULL,lease_expires_at=NULL,updated_at=$2
       WHERE id=$1 AND tenant_id=$3 AND workspace_id=$4 AND work_id=$5
         AND kind='user' AND status='failed'
       RETURNING ${COLUMNS}`,
      [
        input.id,
        input.updatedAt,
        input.owner.tenantId,
        input.owner.workspaceId,
        input.workId,
      ],
    );
    return result.rows?.[0] ? mapRow(result.rows[0]) : false;
  }

  private async transactionClient(): Promise<Client> {
    if (
      !('connect' in this.database) ||
      typeof this.database.connect !== 'function'
    )
      throw new Error('Work Chat persistence requires a transaction client.');
    return this.database.connect();
  }
}

function mapRow(row: Row): WorkChatMessage {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    workId: row.work_id,
    preparationId: row.preparation_id ?? null,
    workRunId: row.work_run_id ?? null,
    sequence: Number(row.sequence),
    kind: row.kind,
    body: row.body,
    status: row.status,
    replyToMessageId: row.reply_to_message_id,
    clientRequestId: row.client_request_id,
    leaseOwner: row.lease_owner,
    leaseFence: Number(row.lease_fence),
    leaseExpiresAt:
      row.lease_expires_at === null ? null : iso(row.lease_expires_at),
    attemptCount: Number(row.attempt_count),
    sourceRuntimeTurnId: row.source_runtime_turn_id,
    failureCode: row.failure_code,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
