import type { ChatActivationCause } from '../../domain/chat/chat-activation.js';
import type {
  ChatActivationPriority,
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
  activation_key: string;
  priority: ChatActivationPriority;
  available_at: string | Date;
  created_at: string | Date;
  updated_at: string | Date;
  published_at: string | Date | null;
  claimed_by: string | null;
  claim_expires_at: string | Date | null;
  attempt_count: string | number;
};

type CauseRow = {
  cause_key: string;
  cause_kind: 'conversation_message' | 'work_wake';
  conversation_id: string;
  through_sequence: string | number;
  payload: Record<string, unknown> | string | null;
};

const isoDate = (value: string | Date | null | undefined): string | null => {
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
    readonly cause?: ChatActivationCause;
    readonly priority?: ChatActivationPriority;
    readonly debounceMs?: number;
  }): Promise<{ readonly enqueued: boolean; readonly dispatchId?: string }> {
    assertSequence(input.throughSequence);
    const cause = input.cause ?? {
      type: 'unread_message' as const,
      conversationId: input.conversationId,
      throughSequence: input.throughSequence,
    };
    if (
      cause.conversationId !== input.conversationId ||
      cause.throughSequence !== input.throughSequence
    )
      throw new Error('Chat activation cause does not match its dispatch.');

    const existingCause = await this.database.query<{ dispatch_id: string | number }>(
      'SELECT dispatch_id FROM chat_activation_causes WHERE cause_key=$1',
      [input.dedupeKey],
    );
    if (existingCause.rows?.[0]) {
      return {
        enqueued: false,
        dispatchId: String(existingCause.rows[0].dispatch_id),
      };
    }

    const now = new Date();
    const debounceMs = boundedDebounce(input.debounceMs ?? 0);
    const availableAt = new Date(now.getTime() + debounceMs).toISOString();
    const createdAt = now.toISOString();
    const priority = input.priority ?? priorityForCause(cause);
    const activationKey = activationKeyFor(input);

    const dispatch = await this.database.query<ChatDispatchRow>(
      `INSERT INTO chat_dispatches
         (tenant_id,agent_definition_id,conversation_id,through_sequence,
          dedupe_key,activation_key,priority,available_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
       ON CONFLICT (activation_key)
       WHERE published_at IS NULL AND claimed_by IS NULL
       DO UPDATE SET
         through_sequence=GREATEST(chat_dispatches.through_sequence, EXCLUDED.through_sequence),
         priority=CASE
           WHEN chat_dispatches.priority='urgent' OR EXCLUDED.priority='urgent' THEN 'urgent'
           ELSE 'normal'
         END,
         available_at=GREATEST(chat_dispatches.available_at, EXCLUDED.available_at),
         updated_at=EXCLUDED.updated_at
       RETURNING *`,
      [
        input.tenantId,
        input.agentDefinitionId,
        input.conversationId,
        input.throughSequence,
        input.dedupeKey,
        activationKey,
        priority,
        availableAt,
        createdAt,
      ],
    );
    const row = dispatch.rows?.[0];
    if (!row) throw new Error('Chat activation could not be admitted.');

    const insertedCause = await this.database.query<{ dispatch_id: string | number }>(
      `INSERT INTO chat_activation_causes
         (cause_key,dispatch_id,tenant_id,agent_definition_id,conversation_id,
          cause_kind,through_sequence,payload,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
       ON CONFLICT (cause_key) DO NOTHING
       RETURNING dispatch_id`,
      [
        input.dedupeKey,
        row.id,
        input.tenantId,
        input.agentDefinitionId,
        input.conversationId,
        cause.type === 'work_wake' ? 'work_wake' : 'conversation_message',
        input.throughSequence,
        JSON.stringify(causePayload(cause)),
        createdAt,
      ],
    );
    const causeRow = insertedCause.rows?.[0];
    if (!causeRow) {
      const replay = await this.database.query<{ dispatch_id: string | number }>(
        'SELECT dispatch_id FROM chat_activation_causes WHERE cause_key=$1',
        [input.dedupeKey],
      );
      return {
        enqueued: false,
        ...(replay.rows?.[0]
          ? { dispatchId: String(replay.rows[0].dispatch_id) }
          : {}),
      };
    }
    return { enqueued: true, dispatchId: String(causeRow.dispatch_id) };
  }

  async listPending(limit: number): Promise<readonly ChatDispatch[]> {
    const result = await this.database.query<ChatDispatchRow>(
      `SELECT * FROM chat_dispatches
       WHERE published_at IS NULL
         AND available_at <= NOW()
         AND (claimed_by IS NULL OR claim_expires_at <= NOW())
       ORDER BY CASE priority WHEN 'urgent' THEN 0 ELSE 1 END,
                available_at ASC, created_at ASC, id ASC LIMIT $1`,
      [limit],
    );
    return Promise.all((result.rows ?? []).map((row) => this.mapDispatch(row)));
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
           AND available_at <= NOW()
           AND (claimed_by IS NULL OR claim_expires_at <= NOW())
         ORDER BY CASE priority WHEN 'urgent' THEN 0 ELSE 1 END,
                  available_at ASC, created_at ASC, id ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE chat_dispatches AS dispatch
       SET claimed_by=$1,
           claim_expires_at=NOW() + ($2::bigint * INTERVAL '1 millisecond'),
           attempt_count=dispatch.attempt_count + 1,
           updated_at=NOW()
       FROM candidate
       WHERE dispatch.id=candidate.id
       RETURNING dispatch.*`,
      [workerId, leaseMs],
    );
    const row = result.rows?.[0];
    return row ? this.mapDispatch(row) : null;
  }

  async completeClaim(input: {
    readonly id: string;
    readonly workerId: string;
    readonly publishedAt: string;
  }): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE chat_dispatches
       SET published_at=$3, claimed_by=NULL, claim_expires_at=NULL, updated_at=$3
       WHERE id=$1
         AND claimed_by=$2
         AND published_at IS NULL
         AND claim_expires_at > NOW()`,
      [input.id, input.workerId, input.publishedAt],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async releaseClaim(input: {
    readonly id: string;
    readonly workerId: string;
  }): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE chat_dispatches
       SET claimed_by=NULL, claim_expires_at=NULL, available_at=NOW(), updated_at=NOW()
       WHERE id=$1 AND claimed_by=$2 AND published_at IS NULL`,
      [input.id, input.workerId],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async markPublished(id: string, publishedAt: string): Promise<void> {
    await this.database.query(
      `UPDATE chat_dispatches
       SET published_at=$2, claimed_by=NULL, claim_expires_at=NULL, updated_at=$2
       WHERE id=$1`,
      [id, publishedAt],
    );
  }

  async getRuntimeWatermark(input: {
    readonly agentChatRuntimeId: string;
    readonly runtimeEpoch: number;
    readonly tenantId: string;
    readonly conversationId: string;
  }): Promise<number> {
    const result = await this.database.query<{ last_admitted_sequence: string | number }>(
      `SELECT last_admitted_sequence
       FROM agent_chat_runtime_watermarks
       WHERE agent_chat_runtime_id=$1 AND runtime_epoch=$2
         AND tenant_id=$3 AND conversation_id=$4`,
      [
        input.agentChatRuntimeId,
        input.runtimeEpoch,
        input.tenantId,
        input.conversationId,
      ],
    );
    return Number(result.rows?.[0]?.last_admitted_sequence ?? 0);
  }

  async advanceRuntimeWatermark(input: {
    readonly agentChatRuntimeId: string;
    readonly runtimeEpoch: number;
    readonly tenantId: string;
    readonly conversationId: string;
    readonly throughSequence: number;
  }): Promise<number> {
    assertSequence(input.throughSequence);
    const result = await this.database.query<{ last_admitted_sequence: string | number }>(
      `INSERT INTO agent_chat_runtime_watermarks
         (agent_chat_runtime_id,runtime_epoch,tenant_id,conversation_id,
          last_admitted_sequence,updated_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (agent_chat_runtime_id,runtime_epoch,conversation_id)
       DO UPDATE SET
         last_admitted_sequence=GREATEST(
           agent_chat_runtime_watermarks.last_admitted_sequence,
           EXCLUDED.last_admitted_sequence
         ),
         updated_at=NOW()
       RETURNING last_admitted_sequence`,
      [
        input.agentChatRuntimeId,
        input.runtimeEpoch,
        input.tenantId,
        input.conversationId,
        input.throughSequence,
      ],
    );
    const value = Number(result.rows?.[0]?.last_admitted_sequence ?? 0);
    if (!Number.isSafeInteger(value))
      throw new Error('Chat runtime watermark could not be persisted.');
    return value;
  }

  private async mapDispatch(row: ChatDispatchRow): Promise<ChatDispatch> {
    const causes = await this.database.query<CauseRow>(
      `SELECT cause_key,cause_kind,conversation_id,through_sequence,payload
       FROM chat_activation_causes
       WHERE dispatch_id=$1
       ORDER BY through_sequence,id`,
      [row.id],
    );
    return Object.freeze({
      id: String(row.id),
      tenantId: row.tenant_id,
      agentDefinitionId: row.agent_definition_id,
      conversationId: row.conversation_id,
      throughSequence: Number(row.through_sequence),
      dedupeKey: row.dedupe_key,
      activationKey: row.activation_key,
      priority: row.priority,
      causes: Object.freeze((causes.rows ?? []).map(mapCause)),
      availableAt: isoDate(row.available_at)!,
      createdAt: isoDate(row.created_at)!,
      publishedAt: isoDate(row.published_at),
    });
  }
}

function mapCause(row: CauseRow): ChatActivationCause {
  const payload = parsePayload(row.payload);
  const throughSequence = Number(row.through_sequence);
  if (row.cause_kind === 'work_wake') {
    return Object.freeze({
      type: 'work_wake' as const,
      conversationId: row.conversation_id,
      throughSequence,
      deliveryId: requiredString(payload.deliveryId, 'deliveryId'),
      workId: requiredString(payload.workId, 'workId'),
      workRef: requiredString(payload.workRef, 'workRef'),
      productState: requiredWorkState(payload.productState),
    });
  }
  return Object.freeze({
    type: 'unread_message' as const,
    conversationId: row.conversation_id,
    throughSequence,
    ...(typeof payload.messageId === 'string' && payload.messageId
      ? { messageId: payload.messageId }
      : {}),
  });
}

function causePayload(cause: ChatActivationCause): Record<string, unknown> {
  return cause.type === 'work_wake'
    ? {
        deliveryId: cause.deliveryId,
        workId: cause.workId,
        workRef: cause.workRef,
        productState: cause.productState,
      }
    : cause.messageId
      ? { messageId: cause.messageId }
      : {};
}

function activationKeyFor(input: {
  readonly tenantId: string;
  readonly agentDefinitionId: string;
  readonly conversationId: string;
}): string {
  return `chat-activation:${input.tenantId}:${input.agentDefinitionId}:${input.conversationId}`;
}

function priorityForCause(cause: ChatActivationCause): ChatActivationPriority {
  return cause.type === 'work_wake' && cause.productState !== 'complete'
    ? 'urgent'
    : 'normal';
}

function boundedDebounce(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1_000, Math.trunc(value)));
}

function assertSequence(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error('Chat activation through-sequence is invalid.');
}

function parsePayload(value: CauseRow['payload']): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch {
      return {};
    }
  }
  return value;
}

function requiredString(
  value: unknown,
  field: string,
): string {
  if (typeof value !== 'string' || !value)
    throw new Error(`Chat activation cause ${field} is missing.`);
  return value;
}

function requiredWorkState(value: unknown): 'complete' | 'needs_you' | 'problem' {
  if (value === 'complete' || value === 'needs_you' || value === 'problem')
    return value;
  throw new Error('Chat activation Work state is invalid.');
}
