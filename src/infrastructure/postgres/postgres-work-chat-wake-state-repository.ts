import type { ChatWorkCard } from '../../application/product-projection/chat-work-card-projection.js';
import type { ChatDispatchRepository } from '../../application/ports/chat-dispatch-repository.js';
import type { WorkChatWakeDelivery } from '../../application/work-chat/work-chat-wake-delivery.js';
import type {
  WorkChatWakeStateRepository,
  WorkChatWakeWorkKey,
} from '../../application/work-chat/work-chat-wake-state-repository.js';
import type { ProductState } from '../../contracts/product-projection/index.js';
import { PostgresChatDispatchRepository } from './postgres-chat-dispatch-repository.js';

interface Queryable {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{
    readonly rows?: readonly Row[];
    readonly rowCount?: number | null;
    readonly affectedRows?: number | null;
  }>;
}

export interface WorkChatWakeDatabase extends Queryable {
  connect(): Promise<Client>;
}

interface Client extends Queryable {
  release(): void;
}

type StateRow = {
  last_observed_state: string;
  transition_no: string | number;
};
type OutboxRow = {
  id: string | number;
  tenant_id: string;
  workspace_id: string;
  work_id: string;
  transition_no: string | number;
  conversation_id: string;
  work_ref: string;
  title: string;
  product_state: ProductState;
  problem_kind: 'failed' | 'cancelled' | 'not_captured' | null;
  attention_reason: 'completion_approval_pending' | 'not_captured' | null;
  result_summary: string | null;
  result_capture_status:
    'present' | 'not_present' | 'redacted' | 'not_captured';
  observed_at: string | Date;
};

/** Durable transition checkpoint plus leaseable Chat wake outbox. */
export class PostgresWorkChatWakeStateRepository implements WorkChatWakeStateRepository {
  readonly #chatActivations: PostgresChatDispatchRepository;

  public constructor(private readonly database: WorkChatWakeDatabase) {
    this.#chatActivations = new PostgresChatDispatchRepository(database);
  }

  public async observe(input: {
    readonly key: WorkChatWakeWorkKey;
    readonly card: ChatWorkCard;
    readonly conversationId: string | null;
    readonly observedAt: string;
  }): Promise<'unchanged' | 'recorded' | 'queued'> {
    const client = await this.acquire();
    try {
      await client.query('BEGIN');
      const inserted = await client.query<StateRow>(
        `INSERT INTO work_chat_wake_states
           (tenant_id, workspace_id, work_id, last_observed_state, transition_no, last_observed_at)
         VALUES ($1, $2, $3, $4, 1, $5)
         ON CONFLICT (tenant_id, workspace_id, work_id) DO NOTHING
         RETURNING last_observed_state, transition_no`,
        [
          input.key.tenantId,
          input.key.workspaceId,
          input.key.workId,
          input.card.productState,
          input.observedAt,
        ],
      );
      const firstObservation = (inserted.rows?.length ?? 0) > 0;
      const existing = firstObservation
        ? null
        : await client.query<StateRow>(
            `SELECT last_observed_state, transition_no
             FROM work_chat_wake_states
             WHERE tenant_id=$1 AND workspace_id=$2 AND work_id=$3
             FOR UPDATE`,
            [input.key.tenantId, input.key.workspaceId, input.key.workId],
          );
      if (
        !firstObservation &&
        existing?.rows?.[0]?.last_observed_state === input.card.productState
      ) {
        await client.query('COMMIT');
        return 'unchanged';
      }

      const transitionNo = firstObservation
        ? 1
        : Number(existing?.rows?.[0]?.transition_no ?? 0) + 1;
      if (!firstObservation) {
        const updated = await client.query(
          `UPDATE work_chat_wake_states
           SET last_observed_state=$4, transition_no=$5, last_observed_at=$6
           WHERE tenant_id=$1 AND workspace_id=$2 AND work_id=$3`,
          [
            input.key.tenantId,
            input.key.workspaceId,
            input.key.workId,
            input.card.productState,
            transitionNo,
            input.observedAt,
          ],
        );
        if ((updated.rowCount ?? updated.affectedRows ?? 0) !== 1)
          throw new Error('Work Chat wake state disappeared during admission.');
      }

      if (input.conversationId && isEligibleState(input.card.productState)) {
        await client.query(
          `INSERT INTO work_chat_wake_outbox
             (tenant_id, workspace_id, work_id, conversation_id, work_ref,
              transition_no, title, product_state, problem_kind, attention_reason,
              result_summary, result_capture_status, observed_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)`,
          [
            input.key.tenantId,
            input.key.workspaceId,
            input.key.workId,
            input.conversationId,
            input.card.workRef,
            transitionNo,
            input.card.title,
            input.card.productState,
            input.card.problemKind,
            input.card.attentionReason,
            input.card.resultSummary,
            input.card.resultCaptureStatus,
            input.observedAt,
          ],
        );
        await client.query('COMMIT');
        return 'queued';
      }

      await client.query('COMMIT');
      return 'recorded';
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* preserve the original database error */
      }
      throw error;
    } finally {
      client.release();
    }
  }

  public async claimPending(
    workerId: string,
    leaseMs: number,
  ): Promise<WorkChatWakeDelivery | null> {
    const result = await this.database.query<OutboxRow>(
      `WITH candidate AS (
         SELECT id
         FROM work_chat_wake_outbox
         WHERE delivered_at IS NULL
           AND (lease_expires_at IS NULL OR lease_expires_at <= now())
         ORDER BY created_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE work_chat_wake_outbox AS outbox
       SET claimed_by=$1,
           lease_expires_at=now() + ($2 * interval '1 millisecond'),
           attempt_count=outbox.attempt_count + 1
       FROM candidate
       WHERE outbox.id=candidate.id
       RETURNING outbox.id, outbox.tenant_id, outbox.workspace_id,
         outbox.work_id, outbox.transition_no, outbox.conversation_id,
         outbox.work_ref, outbox.title,
         outbox.product_state, outbox.problem_kind, outbox.attention_reason,
         outbox.result_summary, outbox.result_capture_status, outbox.observed_at`,
      [workerId, leaseMs],
    );
    const row = result.rows?.[0];
    return row ? mapDelivery(row) : null;
  }

  public enqueueChatActivation(
    input: Parameters<ChatDispatchRepository['enqueue']>[0],
  ): ReturnType<ChatDispatchRepository['enqueue']> {
    return this.#chatActivations.enqueue(input);
  }

  public async markDelivered(
    deliveryId: string,
    workerId: string,
  ): Promise<void> {
    const result = await this.database.query(
      `UPDATE work_chat_wake_outbox
       SET delivered_at=now(), claimed_by=NULL, lease_expires_at=NULL
       WHERE id=$1 AND claimed_by=$2 AND delivered_at IS NULL`,
      [deliveryId, workerId],
    );
    if ((result.rowCount ?? result.affectedRows ?? 0) !== 1)
      throw new Error('Work Chat wake delivery lease was lost.');
  }

  private async acquire(): Promise<Client> {
    return await this.database.connect();
  }
}

function mapDelivery(row: OutboxRow): WorkChatWakeDelivery {
  return {
    deliveryId: String(row.id),
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    workId: row.work_id,
    conversationId: row.conversation_id,
    card: {
      workId: row.work_id,
      workRef: row.work_ref,
      title: row.title,
      productState: row.product_state,
      problemKind: row.problem_kind,
      attentionReason: row.attention_reason,
      resultSummary: row.result_summary,
      resultCaptureStatus: row.result_capture_status,
    },
    observedAt:
      row.observed_at instanceof Date
        ? row.observed_at.toISOString()
        : row.observed_at,
  };
}

function isEligibleState(
  state: ChatWorkCard['productState'],
): state is 'complete' | 'needs_you' | 'problem' {
  return state === 'complete' || state === 'needs_you' || state === 'problem';
}
