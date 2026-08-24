import { randomUUID } from 'node:crypto';
import type { ChannelRepository } from '../../application/ports/channel-repository.js';
import type {
  LarkBindingSessionPort,
  LarkBindingSessionResolutionInput,
} from '../../application/channels/resolve-lark-binding.js';
import type { AccessContext } from '../../domain/access-context.js';
import type {
  ChannelConversationBinding,
  ChannelConversationBindingInput,
  ChannelIngress,
  ChannelIngressInput,
} from '../../domain/channels/channel-event.js';
import type {
  ChannelDeliveryAttemptInput,
  ChannelOutbox,
  ChannelOutboxInput,
} from '../../domain/channels/channel-delivery.js';
import { MAX_CHANNEL_IDENTIFIER_BYTES } from '../../domain/channels/channel-identifiers.js';

type QueryResult<Row> = {
  readonly rows: readonly Row[];
  readonly rowCount?: number | null;
  readonly affectedRows?: number;
};

type Queryable = {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
};

type Transactional = Queryable & { release?: () => void };
type Connectable = { connect(): Promise<Transactional> };
type Database = Queryable | (Queryable & Connectable);

type IngressRow = {
  id: string;
  connection_key: string;
  kind: ChannelIngress['kind'];
  external_key: string;
  provider_event_id: string | null;
  external_message_id: string | null;
  chat_id: string;
  root_message_id: string | null;
  thread_id: string | null;
  reply_to_id: string | null;
  external_actor_id: string | null;
  text: string | null;
  action: Record<string, string | number | boolean | null> | null;
  bot_mention_verified: boolean | null;
  normalization_version: string;
  status: ChannelIngress['status'];
  attempt_count: number;
  lease_owner: string | null;
  lease_expires_at: string | Date | null;
  safe_error_code: string | null;
  admitted_session_id: string | null;
  admitted_task_id: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type BindingRow = {
  id: string;
  connection_key: string;
  chat_id: string;
  root_message_id: string;
  session_id: string | null;
  creating_ingress_id: string;
  status: ChannelConversationBinding['status'];
  created_at: string | Date;
  updated_at: string | Date;
};

type OutboxRow = {
  id: string;
  connection_key: string;
  binding_id: string | null;
  target_id: string;
  delivery_kind: string;
  aggregate_id: string;
  aggregate_version: number;
  payload: string;
  provider_request_id: string;
  status: ChannelOutbox['status'];
  attempt_count: number;
  lease_owner: string | null;
  lease_expires_at: string | Date | null;
  next_attempt_at: string | Date | null;
  last_safe_error: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

const MAX_TEXT_BYTES = 8192;
const MAX_ACTION_BYTES = 8192;
const MAX_PAYLOAD_BYTES = 8192;
const MAX_ERROR_BYTES = 256;

export class PostgresChannelRepository
  implements ChannelRepository, LarkBindingSessionPort
{
  private transactionTail: Promise<void> = Promise.resolve();

  public constructor(private readonly database: Database) {}

  public async insertIngress(input: ChannelIngressInput) {
    validateIngress(input);
    const inserted = await this.database.query<IngressRow>(
      `
        INSERT INTO channel_ingress_events (
          id, connection_key, kind, external_key, provider_event_id,
          external_message_id, chat_id, root_message_id, thread_id, reply_to_id,
          external_actor_id, text, action, bot_mention_verified, normalization_version
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15)
        ON CONFLICT DO NOTHING
        RETURNING *
      `,
      [
        input.id,
        input.connectionKey,
        input.kind,
        input.externalKey,
        input.providerEventId ?? null,
        input.externalMessageId ?? null,
        input.chatId,
        input.rootMessageId ?? null,
        input.threadId ?? null,
        input.replyToId ?? null,
        input.externalActorId ?? null,
        input.text ?? null,
        input.action === undefined ? null : JSON.stringify(input.action),
        input.botMentionVerified ?? null,
        input.normalizationVersion,
      ],
    );
    const row =
      inserted.rows[0] ??
      (input.externalMessageId && input.kind !== 'card_action'
        ? (
            await this.database.query<IngressRow>(
              'SELECT * FROM channel_ingress_events WHERE connection_key = $1 AND external_message_id = $2',
              [input.connectionKey, input.externalMessageId],
            )
          ).rows[0]
        : undefined) ??
      (
        await this.database.query<IngressRow>(
          'SELECT * FROM channel_ingress_events WHERE connection_key = $1 AND kind = $2 AND external_key = $3',
          [input.connectionKey, input.kind, input.externalKey],
        )
      ).rows[0];
    if (!row) throw new Error('channel ingress insert did not return a record');
    if (
      !inserted.rows[0] &&
      !(
        input.externalMessageId &&
        row.external_message_id === input.externalMessageId &&
        (row.kind !== input.kind || row.external_key !== input.externalKey)
      ) &&
      !sameIngress(row, input)
    ) {
      throw new Error('channel ingress logical key conflict');
    }
    return { record: mapIngress(row), inserted: inserted.rows.length > 0 };
  }

  public async claimIngress(
    workerId: string,
    leaseMs: number,
  ): Promise<ChannelIngress | null> {
    validateLease(workerId, leaseMs);
    const result = await this.database.query<IngressRow>(
      `
        WITH candidate AS (
          SELECT id
          FROM channel_ingress_events
          WHERE (status = 'pending' OR (status = 'processing' AND lease_expires_at < now()))
            AND (lease_expires_at IS NULL OR lease_expires_at < now())
          ORDER BY created_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE channel_ingress_events AS event
        SET status = 'processing', lease_owner = $1,
            lease_expires_at = now() + ($2::double precision * interval '1 millisecond'),
            attempt_count = event.attempt_count + 1, updated_at = now()
        FROM candidate
        WHERE event.id = candidate.id
        RETURNING event.*
      `,
      [workerId, leaseMs],
    );
    return result.rows[0] ? mapIngress(result.rows[0]) : null;
  }

  public async completeIngress(input: {
    readonly ingressId: string;
    readonly status: 'processed' | 'failed';
    readonly safeErrorCode?: string;
    readonly admittedSessionId?: string;
    readonly admittedTaskId?: string;
    readonly leaseOwner: string;
    readonly attemptNumber: number;
  }): Promise<void> {
    bounded(input.ingressId, 'ingressId');
    if (input.safeErrorCode !== undefined)
      bounded(input.safeErrorCode, 'safeErrorCode', MAX_ERROR_BYTES);
    if (!Number.isInteger(input.attemptNumber) || input.attemptNumber < 1)
      throw new Error('channel ingress fence requires owner and attempt');
    const result = await this.database.query(
      `UPDATE channel_ingress_events
       SET status = $2, safe_error_code = $3, admitted_session_id = $4,
           admitted_task_id = $5, lease_owner = NULL, lease_expires_at = NULL,
           updated_at = now()
       WHERE id = $1 AND status = 'processing' AND lease_owner = $6 AND attempt_count = $7`,
      [
        input.ingressId,
        input.status,
        input.safeErrorCode ?? null,
        input.admittedSessionId ?? null,
        input.admittedTaskId ?? null,
        input.leaseOwner,
        input.attemptNumber,
      ],
    );
    if ((result.rowCount ?? result.affectedRows ?? 0) !== 1)
      throw new Error('channel ingress fence failed');
  }

  public async releaseIngress(input: {
    readonly ingressId: string;
    readonly leaseOwner: string;
    readonly attemptNumber: number;
    readonly safeErrorCode: string;
  }): Promise<void> {
    bounded(input.ingressId, 'ingressId');
    bounded(input.leaseOwner, 'leaseOwner', 256);
    bounded(input.safeErrorCode, 'safeErrorCode', MAX_ERROR_BYTES);
    if (!Number.isInteger(input.attemptNumber) || input.attemptNumber < 1)
      throw new Error('invalid ingress attempt');
    const result = await this.database.query(
      `UPDATE channel_ingress_events SET status='pending', safe_error_code=$4, lease_owner=NULL, lease_expires_at=NULL, updated_at=now() WHERE id=$1 AND status='processing' AND lease_owner=$2 AND attempt_count=$3`,
      [
        input.ingressId,
        input.leaseOwner,
        input.attemptNumber,
        input.safeErrorCode,
      ],
    );
    if ((result.rowCount ?? result.affectedRows ?? 0) !== 1)
      throw new Error('channel ingress fence failed');
  }

  public async completeIngressAdministrative(input: {
    readonly ingressId: string;
    readonly status: 'processed' | 'failed';
    readonly safeErrorCode?: string;
    readonly admittedSessionId?: string;
    readonly admittedTaskId?: string;
  }): Promise<void> {
    bounded(input.ingressId, 'ingressId');
    const result = await this.database.query(
      `UPDATE channel_ingress_events SET status=$2, safe_error_code=$3,
       admitted_session_id=$4, admitted_task_id=$5, lease_owner=NULL,
       lease_expires_at=NULL, updated_at=now() WHERE id=$1`,
      [
        input.ingressId,
        input.status,
        input.safeErrorCode ?? null,
        input.admittedSessionId ?? null,
        input.admittedTaskId ?? null,
      ],
    );
    if ((result.rowCount ?? result.affectedRows ?? 0) !== 1)
      throw new Error('channel ingress record is required');
  }

  public async findBinding(input: {
    readonly connectionKey: string;
    readonly chatId: string;
    readonly rootMessageId: string;
  }) {
    const result = await this.database.query<BindingRow>(
      `SELECT * FROM channel_conversation_bindings
       WHERE connection_key = $1 AND chat_id = $2 AND root_message_id = $3 AND status = 'active'`,
      [input.connectionKey, input.chatId, input.rootMessageId],
    );
    const row = result.rows[0];
    return row ? mapBinding(row) : null;
  }

  public async resolveBindingWithSession(
    input: LarkBindingSessionResolutionInput,
  ) {
    return this.withTransaction(async (database) => {
      const inserted = input.createIfMissing
        ? await database.query<BindingRow>(
            `INSERT INTO channel_conversation_bindings
             (id, connection_key, chat_id, root_message_id, creating_ingress_id)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (connection_key, chat_id, root_message_id) DO NOTHING
             RETURNING *`,
            [
              randomUUID(),
              input.connectionKey,
              input.chatId,
              input.rootMessageId,
              input.creatingIngressId,
            ],
          )
        : { rows: [] as BindingRow[] };
      const selected = inserted.rows[0]
        ? inserted.rows[0]
        : (
            await database.query<BindingRow>(
              `SELECT * FROM channel_conversation_bindings
               WHERE connection_key = $1 AND chat_id = $2 AND root_message_id = $3
               FOR UPDATE`,
              [input.connectionKey, input.chatId, input.rootMessageId],
            )
          ).rows[0];
      if (!selected) throw new Error('channel binding record is required');
      if (selected.session_id) {
        const session = await database.query<{ id: string }>(
          `SELECT id FROM product_sessions
           WHERE id = $1 AND tenant_id = $2 AND workspace_id = $3
             AND principal_type = $4 AND principal_id = $5
             AND published_agent_version_id = $6
           FOR SHARE`,
          [
            selected.session_id,
            input.owner.tenantId,
            input.owner.workspaceId,
            input.owner.principalType,
            input.owner.principalId,
            input.publishedAgentVersionId,
          ],
        );
        if (!session.rows[0]) throw new Error('not_found');
        return {
          binding: mapBinding(selected),
          sessionId: selected.session_id,
          created: false,
        };
      }
      await assertSessionCreationAllowed(
        database,
        input.owner,
        input.publishedAgentVersionId,
      );
      const sessionId = randomUUID();
      const now = new Date().toISOString();
      await database.query(
        `INSERT INTO product_sessions
         (id, workspace_id, tenant_id, principal_type, principal_id,
          published_agent_version_id, generation, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 0, 'active', $7, $7)`,
        [
          sessionId,
          input.owner.workspaceId,
          input.owner.tenantId,
          input.owner.principalType,
          input.owner.principalId,
          input.publishedAgentVersionId,
          now,
        ],
      );
      await database.query(
        'INSERT INTO session_lanes(session_id, generation) VALUES ($1, 0)',
        [sessionId],
      );
      const updated = await database.query<BindingRow>(
        `UPDATE channel_conversation_bindings SET session_id = $2, updated_at = now()
         WHERE id = $1 RETURNING *`,
        [selected.id, sessionId],
      );
      if (!updated.rows[0])
        throw new Error('channel binding update was not applied');
      return { binding: mapBinding(updated.rows[0]), sessionId, created: true };
    });
  }

  public async resolveBinding(
    input: ChannelConversationBindingInput,
  ): Promise<ChannelConversationBinding> {
    for (const [label, value] of Object.entries(input)) {
      if (label !== 'sessionId' && typeof value === 'string')
        bounded(value, label);
    }
    const result = await this.database.query<BindingRow>(
      `
        INSERT INTO channel_conversation_bindings
          (id, connection_key, chat_id, root_message_id, session_id, creating_ingress_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (connection_key, chat_id, root_message_id) DO NOTHING
        RETURNING *
      `,
      [
        input.id,
        input.connectionKey,
        input.chatId,
        input.rootMessageId,
        input.sessionId ?? null,
        input.creatingIngressId,
      ],
    );
    const row =
      result.rows[0] ??
      (
        await this.database.query<BindingRow>(
          'SELECT * FROM channel_conversation_bindings WHERE connection_key = $1 AND chat_id = $2 AND root_message_id = $3',
          [input.connectionKey, input.chatId, input.rootMessageId],
        )
      ).rows[0];
    if (!row) throw new Error('channel binding insert did not return a record');
    if (!result.rows[0] && !sameBinding(row, input)) {
      throw new Error('channel binding logical key conflict');
    }
    return mapBinding(row);
  }

  public async findBindingBySessionId(input: {
    readonly connectionKey: string;
    readonly sessionId: string;
  }): Promise<ChannelConversationBinding | null> {
    const result = await this.database.query<BindingRow>(
      `SELECT * FROM channel_conversation_bindings
       WHERE connection_key = $1 AND session_id = $2 AND status = 'active'
       ORDER BY created_at, id
       LIMIT 1`,
      [input.connectionKey, input.sessionId],
    );
    return result.rows[0] ? mapBinding(result.rows[0]) : null;
  }

  public async saveOutbox(input: ChannelOutboxInput) {
    validateOutbox(input);
    const result = await this.database.query<OutboxRow>(
      `
        INSERT INTO channel_outbox (
          id, connection_key, binding_id, target_id, delivery_kind, aggregate_id,
          aggregate_version, payload, provider_request_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (connection_key, delivery_kind, aggregate_id, aggregate_version)
        DO NOTHING
        RETURNING *
      `,
      [
        input.id,
        input.connectionKey,
        input.bindingId,
        input.targetId,
        input.deliveryKind,
        input.aggregateId,
        input.aggregateVersion,
        input.payload,
        input.providerRequestId,
      ],
    );
    const row =
      result.rows[0] ??
      (
        await this.database.query<OutboxRow>(
          `SELECT * FROM channel_outbox WHERE connection_key = $1 AND delivery_kind = $2 AND aggregate_id = $3 AND aggregate_version = $4`,
          [
            input.connectionKey,
            input.deliveryKind,
            input.aggregateId,
            input.aggregateVersion,
          ],
        )
      ).rows[0];
    if (!row) throw new Error('channel outbox insert did not return a record');
    if (!result.rows[0] && !sameOutbox(row, input)) {
      throw new Error('channel outbox logical key conflict');
    }
    return { record: mapOutbox(row), inserted: result.rows.length > 0 };
  }

  public async claimOutbox(
    workerId: string,
    leaseMs: number,
  ): Promise<ChannelOutbox | null> {
    validateLease(workerId, leaseMs);
    const result = await this.database.query<OutboxRow>(
      `
        WITH candidate AS (
          SELECT id
          FROM channel_outbox
          WHERE (
            status IN ('pending', 'retry_wait')
            OR (status = 'sending' AND lease_expires_at < now())
          )
            AND (next_attempt_at IS NULL OR next_attempt_at <= now())
            AND (lease_expires_at IS NULL OR lease_expires_at < now())
          ORDER BY created_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE channel_outbox AS outbox
        SET status = 'sending', lease_owner = $1,
            lease_expires_at = now() + ($2::double precision * interval '1 millisecond'),
            attempt_count = outbox.attempt_count + 1, updated_at = now()
        FROM candidate
        WHERE outbox.id = candidate.id
        RETURNING outbox.*
      `,
      [workerId, leaseMs],
    );
    return result.rows[0] ? mapOutbox(result.rows[0]) : null;
  }

  public async recordAttempt(
    input: ChannelDeliveryAttemptInput,
  ): Promise<void> {
    validateAttempt(input);
    await this.withTransaction(async (database) => {
      const outbox = await database.query<{
        status: ChannelOutbox['status'];
        attempt_count: number;
        lease_owner: string | null;
      }>(
        'SELECT status, attempt_count, lease_owner FROM channel_outbox WHERE id = $1 FOR UPDATE',
        [input.outboxId],
      );
      if (outbox.rows.length !== 1) {
        throw new Error('channel outbox record is required for an attempt');
      }
      const existing = await database.query<AttemptRow>(
        'SELECT * FROM channel_delivery_attempts WHERE outbox_id = $1 AND attempt_number = $2 FOR UPDATE',
        [input.outboxId, input.attemptNumber],
      );
      if (existing.rows[0]) {
        if (!sameAttempt(existing.rows[0], input)) {
          throw new Error('channel delivery attempt conflict');
        }
        return;
      }
      if (outbox.rows[0]!.status !== 'sending') {
        throw new Error('channel outbox must be sending for a new attempt');
      }
      if (
        input.leaseOwner !== undefined &&
        (outbox.rows[0]!.attempt_count !== input.attemptNumber ||
          outbox.rows[0]!.lease_owner !== input.leaseOwner)
      ) {
        throw new Error('channel outbox lease fence failed');
      }
      await database.query(
        `
          INSERT INTO channel_delivery_attempts
            (id, outbox_id, attempt_number, provider_request_id, provider_message_id, result, safe_error_code)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          input.id,
          input.outboxId,
          input.attemptNumber,
          input.providerRequestId ?? null,
          input.providerMessageId ?? null,
          input.result,
          input.safeErrorCode ?? null,
        ],
      );
      const status = {
        delivered: 'delivered',
        retryable_failure: 'retry_wait',
        permanent_failure: 'permanent_failed',
        unknown: 'delivery_unknown',
      }[input.result];
      await database.query(
        `
          UPDATE channel_outbox
          SET status = $2, lease_owner = NULL, lease_expires_at = NULL,
              next_attempt_at = CASE WHEN $2 = 'retry_wait' THEN now() ELSE NULL END,
              last_safe_error = $3, updated_at = now()
          WHERE id = $1 AND status = 'sending'
        `,
        [input.outboxId, status, input.safeErrorCode ?? null],
      );
      const updated = await database.query<{ id: string }>(
        'SELECT id FROM channel_outbox WHERE id = $1 AND status = $2',
        [input.outboxId, status],
      );
      const updatedCount = updated.rowCount ?? updated.rows.length;
      if (updatedCount !== 1) {
        throw new Error('channel outbox update was not applied');
      }
    });
  }

  private async withTransaction<T>(
    work: (database: Transactional) => Promise<T>,
  ): Promise<T> {
    const previous = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const pooled = 'connect' in this.database;
    const client = pooled
      ? await (this.database as Connectable).connect()
      : this.database;
    await client.query('BEGIN');
    try {
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      if (pooled) (client as Transactional).release?.();
      release();
    }
  }
}

async function assertSessionCreationAllowed(
  database: Queryable,
  owner: AccessContext,
  agentVersionId: string,
): Promise<void> {
  const workspace = await database.query(
    `SELECT id FROM workspaces
     WHERE id = $1 AND tenant_id = $2 AND principal_type = $3 AND principal_id = $4`,
    [owner.workspaceId, owner.tenantId, owner.principalType, owner.principalId],
  );
  if (!workspace.rows[0]) throw new Error('not_found');
  const published = await database.query(
    `SELECT id FROM agent_versions
     WHERE id = $1 AND tenant_id = $2 AND principal_type = $3
       AND principal_id = $4 AND status = 'published'`,
    [agentVersionId, owner.tenantId, owner.principalType, owner.principalId],
  );
  if (!published.rows[0]) throw new Error('not_found');
}

function validateIngress(input: ChannelIngressInput): void {
  for (const [label, value] of Object.entries(input)) {
    if (typeof value === 'string' && label !== 'text') bounded(value, label);
  }
  if (input.text !== undefined) bounded(input.text, 'text', MAX_TEXT_BYTES);
  if (input.action !== undefined) validateAction(input.action);
}

function validateOutbox(input: ChannelOutboxInput): void {
  for (const [label, value] of Object.entries(input)) {
    if (typeof value === 'string' && label !== 'payload') bounded(value, label);
  }
  bounded(input.payload, 'payload', MAX_PAYLOAD_BYTES);
  if (!Number.isInteger(input.aggregateVersion) || input.aggregateVersion < 1) {
    throw new Error('invalid aggregate version');
  }
}

function validateAttempt(input: ChannelDeliveryAttemptInput): void {
  for (const [label, value] of Object.entries(input)) {
    if (typeof value === 'string')
      bounded(
        value,
        label,
        label === 'safeErrorCode'
          ? MAX_ERROR_BYTES
          : MAX_CHANNEL_IDENTIFIER_BYTES,
      );
  }
  if (!Number.isInteger(input.attemptNumber) || input.attemptNumber < 1) {
    throw new Error('invalid attempt number');
  }
  if (
    ![
      'delivered',
      'retryable_failure',
      'permanent_failure',
      'unknown',
    ].includes(input.result)
  ) {
    throw new Error('invalid delivery result');
  }
}

function validateAction(
  action: unknown,
): asserts action is Record<string, string | number | boolean | null> {
  if (typeof action !== 'object' || action === null || Array.isArray(action)) {
    throw new Error('invalid channel action shape');
  }
  const entries = Object.entries(action);
  if (entries.length > 32) throw new Error('invalid channel action size');
  for (const [key, value] of entries) {
    bounded(key, 'action key', 64);
    if (/(raw|payload|callback|token|secret|credential|password)/i.test(key)) {
      throw new Error('invalid channel action sensitive key');
    }
    if (
      value !== null &&
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean'
    ) {
      throw new Error('invalid channel action scalar');
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('invalid channel action number');
    }
  }
  bounded(stableJson(action), 'action', MAX_ACTION_BYTES);
}

function validateLease(workerId: string, leaseMs: number): void {
  bounded(workerId, 'workerId', 256);
  if (!Number.isInteger(leaseMs) || leaseMs <= 0)
    throw new Error('invalid lease duration');
}

function bounded(
  value: string,
  label: string,
  maxBytes = MAX_CHANNEL_IDENTIFIER_BYTES,
): void {
  if (value.length === 0 || Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new Error(`invalid channel ${label}`);
  }
}

type AttemptRow = {
  id: string;
  outbox_id: string;
  attempt_number: number;
  provider_request_id: string | null;
  provider_message_id: string | null;
  result: ChannelDeliveryAttemptInput['result'];
  safe_error_code: string | null;
};

function sameBinding(
  row: BindingRow,
  input: ChannelConversationBindingInput,
): boolean {
  return (
    row.connection_key === input.connectionKey &&
    row.chat_id === input.chatId &&
    row.root_message_id === input.rootMessageId &&
    row.session_id === (input.sessionId ?? null) &&
    row.creating_ingress_id === input.creatingIngressId
  );
}

function sameAttempt(
  row: AttemptRow,
  input: ChannelDeliveryAttemptInput,
): boolean {
  return (
    row.id === input.id &&
    row.provider_request_id === (input.providerRequestId ?? null) &&
    row.provider_message_id === (input.providerMessageId ?? null) &&
    row.result === input.result &&
    row.safe_error_code === (input.safeErrorCode ?? null)
  );
}

function sameIngress(row: IngressRow, input: ChannelIngressInput): boolean {
  return (
    row.connection_key === input.connectionKey &&
    row.kind === input.kind &&
    row.external_key === input.externalKey &&
    (input.kind === 'card_action' ||
      (row.provider_event_id ?? null) === (input.providerEventId ?? null)) &&
    (row.external_message_id ?? null) === (input.externalMessageId ?? null) &&
    row.chat_id === input.chatId &&
    (row.root_message_id ?? null) === (input.rootMessageId ?? null) &&
    (row.thread_id ?? null) === (input.threadId ?? null) &&
    (row.reply_to_id ?? null) === (input.replyToId ?? null) &&
    (row.external_actor_id ?? null) === (input.externalActorId ?? null) &&
    (row.bot_mention_verified ?? null) === (input.botMentionVerified ?? null) &&
    (row.text ?? null) === (input.text ?? null) &&
    stableJson(row.action) === stableJson(input.action ?? null) &&
    row.normalization_version === input.normalizationVersion
  );
}

function sameOutbox(row: OutboxRow, input: ChannelOutboxInput): boolean {
  return (
    row.connection_key === input.connectionKey &&
    row.binding_id === input.bindingId &&
    row.target_id === input.targetId &&
    row.delivery_kind === input.deliveryKind &&
    row.aggregate_id === input.aggregateId &&
    row.aggregate_version === input.aggregateVersion &&
    row.payload === input.payload &&
    row.provider_request_id === input.providerRequestId
  );
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)]),
    );
  }
  return value;
}

function instant(value: string | Date): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function optional(value: string | Date | null): string | undefined {
  return value === null ? undefined : instant(value);
}

function mapIngress(row: IngressRow): ChannelIngress {
  return {
    id: row.id,
    connectionKey: row.connection_key,
    kind: row.kind,
    externalKey: row.external_key,
    ...(row.provider_event_id
      ? { providerEventId: row.provider_event_id }
      : {}),
    ...(row.external_message_id
      ? { externalMessageId: row.external_message_id }
      : {}),
    chatId: row.chat_id,
    ...(row.root_message_id ? { rootMessageId: row.root_message_id } : {}),
    ...(row.thread_id ? { threadId: row.thread_id } : {}),
    ...(row.reply_to_id ? { replyToId: row.reply_to_id } : {}),
    ...(row.external_actor_id
      ? { externalActorId: row.external_actor_id }
      : {}),
    ...(row.bot_mention_verified === null
      ? {}
      : { botMentionVerified: row.bot_mention_verified }),
    ...(row.text !== null ? { text: row.text } : {}),
    ...(row.action !== null ? { action: row.action } : {}),
    normalizationVersion: row.normalization_version,
    status: row.status,
    attemptCount: row.attempt_count,
    ...(row.lease_owner ? { leaseOwner: row.lease_owner } : {}),
    ...(row.lease_expires_at
      ? { leaseExpiresAt: instant(row.lease_expires_at) }
      : {}),
    ...(row.safe_error_code ? { safeErrorCode: row.safe_error_code } : {}),
    ...(row.admitted_session_id
      ? { admittedSessionId: row.admitted_session_id }
      : {}),
    ...(row.admitted_task_id ? { admittedTaskId: row.admitted_task_id } : {}),
    createdAt: instant(row.created_at),
    updatedAt: instant(row.updated_at),
  };
}

function mapBinding(row: BindingRow): ChannelConversationBinding {
  return {
    id: row.id,
    connectionKey: row.connection_key,
    chatId: row.chat_id,
    rootMessageId: row.root_message_id,
    ...(row.session_id ? { sessionId: row.session_id } : {}),
    creatingIngressId: row.creating_ingress_id,
    status: row.status,
    createdAt: instant(row.created_at),
    updatedAt: instant(row.updated_at),
  };
}

function mapOutbox(row: OutboxRow): ChannelOutbox {
  return {
    id: row.id,
    connectionKey: row.connection_key,
    bindingId: row.binding_id,
    targetId: row.target_id,
    deliveryKind: row.delivery_kind,
    aggregateId: row.aggregate_id,
    aggregateVersion: row.aggregate_version,
    payload: row.payload,
    providerRequestId: row.provider_request_id,
    status: row.status,
    attemptCount: row.attempt_count,
    ...(row.lease_owner ? { leaseOwner: row.lease_owner } : {}),
    ...(row.lease_expires_at
      ? { leaseExpiresAt: instant(row.lease_expires_at) }
      : {}),
    ...(row.next_attempt_at
      ? { nextAttemptAt: instant(row.next_attempt_at) }
      : {}),
    ...(row.last_safe_error ? { lastSafeError: row.last_safe_error } : {}),
    createdAt: instant(row.created_at),
    updatedAt: instant(row.updated_at),
  };
}
