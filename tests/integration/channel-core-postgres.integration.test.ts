import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChannelIngressInput } from '../../src/domain/channels/channel-event.js';
import type { ChannelOutboxInput } from '../../src/domain/channels/channel-delivery.js';
import { PostgresChannelRepository } from '../../src/infrastructure/postgres/postgres-channel-repository.js';
import {
  applyDurableKernelMigrations,
  durableKernelMigrationFilePaths,
  readDurableKernelMigration,
} from '../../src/infrastructure/postgres/postgres.js';

describe('Postgres channel core (PGlite)', () => {
  let database: PGlite;
  let repository: PostgresChannelRepository;

  beforeEach(async () => {
    database = new PGlite();
    await applyDurableKernelMigrations(database);
    repository = new PostgresChannelRepository(database);
    await database.query(
      `INSERT INTO workspaces(id, tenant_id, principal_type, principal_id, name, created_at, updated_at)
       VALUES ('00000000-0000-4000-8000-000000000901', 'tenant', 'service_account', 'owner', 'Workspace', now(), now())`,
    );
    await database.query(
      `INSERT INTO product_sessions(id, workspace_id, tenant_id, principal_type, principal_id, published_agent_version_id, created_at, updated_at)
       VALUES ('00000000-0000-4000-8000-000000000902', '00000000-0000-4000-8000-000000000901', 'tenant', 'service_account', 'owner', 'version', now(), now())`,
    );
  });

  it('resolves only an active binding for the requested connection and session', async () => {
    await repository.insertIngress({
      ...ingress('message', 'binding-ingress'),
      id: 'binding-ingress',
    });
    await database.query(
      `INSERT INTO channel_conversation_bindings
       (id, connection_key, chat_id, root_message_id, session_id, creating_ingress_id, status)
       VALUES
       ('binding-active', 'lark-canary', 'chat', 'root', '00000000-0000-4000-8000-000000000902', 'binding-ingress', 'active'),
       ('binding-closed', 'other', 'chat-2', 'root-2', '00000000-0000-4000-8000-000000000902', 'binding-ingress', 'closed')`,
    );

    const active = await repository.findBindingBySessionId({
      connectionKey: 'lark-canary',
      sessionId: '00000000-0000-4000-8000-000000000902',
    });
    expect(active?.id).toBe('binding-active');
    expect(
      await repository.findBindingBySessionId({
        connectionKey: 'other',
        sessionId: '00000000-0000-4000-8000-000000000902',
      }),
    ).toBeNull();
    expect(
      await repository.findBindingBySessionId({
        connectionKey: 'lark-canary',
        sessionId: '00000000-0000-4000-8000-000000000903',
      }),
    ).toBeNull();
  });

  afterEach(async () => {
    await database.close();
  });

  it('creates only the four channel core tables and stores safe message/card/command facts', async () => {
    const tableRows = await database.query<{ table_name: string }>(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name LIKE 'channel_%'
        ORDER BY table_name
      `,
    );
    expect(tableRows.rows.map((row) => row.table_name)).toEqual([
      'channel_conversation_bindings',
      'channel_delivery_attempts',
      'channel_ingress_events',
      'channel_outbox',
    ]);

    for (const [index, input] of [
      ingress('message', 'message-1', { text: 'hello' }),
      ingress('card_action', 'card-1', { action: { action: 'accept' } }),
      ingress('command', 'command-1', { text: '/memory accept proposal-1' }),
    ].entries()) {
      const result = await repository.insertIngress({
        ...input,
        id: `ingress-${index + 1}`,
      });
      expect(result.inserted).toBe(true);
      expect(result.record.id).toBe(`ingress-${index + 1}`);
    }

    const stored = await database.query<Record<string, unknown>>(
      'SELECT * FROM channel_ingress_events ORDER BY id',
    );
    expect(stored.rows).toHaveLength(3);
    expect(Object.keys(stored.rows[0] ?? {})).not.toEqual(
      expect.arrayContaining(['raw_payload', 'callback_token']),
    );
    const uuidColumns = await database.query<{
      table_name: string;
      column_name: string;
      data_type: string;
    }>(
      `
        SELECT table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND ((table_name = 'channel_conversation_bindings' AND column_name = 'session_id')
            OR (table_name = 'channel_ingress_events' AND column_name IN ('admitted_session_id', 'admitted_task_id')))
      `,
    );
    expect(uuidColumns.rows).toEqual(
      expect.arrayContaining([
        {
          table_name: 'channel_conversation_bindings',
          column_name: 'session_id',
          data_type: 'uuid',
        },
        {
          table_name: 'channel_ingress_events',
          column_name: 'admitted_session_id',
          data_type: 'uuid',
        },
        {
          table_name: 'channel_ingress_events',
          column_name: 'admitted_task_id',
          data_type: 'uuid',
        },
      ]),
    );
  });

  it('deduplicates a provider message across message and command classification', async () => {
    const message = await repository.insertIngress({
      ...ingress('message', 'same-provider', { text: 'hello' }),
      externalMessageId: 'provider-message-1',
      id: 'message-ingress',
    });
    const command = await repository.insertIngress({
      ...ingress('command', 'different-classification', {
        action: { name: 'memory_review' },
      }),
      externalMessageId: 'provider-message-1',
      id: 'command-ingress',
    });
    expect(message.inserted).toBe(true);
    expect(command.inserted).toBe(false);
    expect(command.record.id).toBe('message-ingress');
    const rows = await database.query(
      'SELECT id FROM channel_ingress_events WHERE connection_key = $1 AND external_message_id = $2',
      ['app/connection', 'provider-message-1'],
    );
    expect(rows.rows).toHaveLength(1);
  });

  it('re-records the channel migration when SQL exists but its registry row is missing', async () => {
    const migrationPath = durableKernelMigrationFilePaths.find((path) =>
      path.includes('0013_channel_core'),
    )!;
    const migrationSql = await readDurableKernelMigration(migrationPath);
    expect(migrationSql).toMatch(/^BEGIN;[\s\S]*COMMIT;\s*$/);
    await database.exec(migrationSql);
    await database.query(`
      CREATE TABLE IF NOT EXISTS durable_kernel_schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await database.query(
      `DELETE FROM durable_kernel_schema_migrations WHERE version = '0013_channel_core'`,
    );
    await applyDurableKernelMigrations(database, [migrationPath]);
    await expect(
      database.query(
        `SELECT version FROM durable_kernel_schema_migrations WHERE version = '0013_channel_core'`,
      ),
    ).resolves.toMatchObject({ rows: [{ version: '0013_channel_core' }] });
  });

  it('rolls back every channel table when migration SQL fails partway through', async () => {
    const isolated = new PGlite();
    const migrationPath = durableKernelMigrationFilePaths.find((path) =>
      path.includes('0013_channel_core'),
    )!;
    const migrationSql = await readDurableKernelMigration(migrationPath);
    try {
      await isolated.exec(
        'CREATE TABLE tasks (id uuid PRIMARY KEY); CREATE TABLE product_sessions (id uuid PRIMARY KEY)',
      );
      await expect(
        isolated.exec(
          migrationSql.replace(
            'CREATE INDEX IF NOT EXISTS channel_outbox_claim_idx',
            'CREATE INDEX channel_outbox_claim_idx BROKEN',
          ),
        ),
      ).rejects.toThrow();
      const tables = await isolated.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'channel_%'`,
      );
      expect(tables.rows).toEqual([]);
    } finally {
      await isolated.close();
    }
  });

  it('converges duplicate and concurrent ingress by connection, kind, and external key', async () => {
    const first = await repository.insertIngress(ingress('message', 'same'));
    const duplicate = await repository.insertIngress({
      ...ingress('message', 'same'),
      id: 'ingress-duplicate',
    });
    expect(first.inserted).toBe(true);
    expect(duplicate).toEqual({ inserted: false, record: first.record });
    await expect(
      repository.insertIngress({
        ...ingress('message', 'same'),
        id: 'ingress-conflict',
        text: 'different text',
      }),
    ).rejects.toThrow(/conflict/);
    const otherConnection = await repository.insertIngress({
      ...ingress('message', 'same'),
      id: 'ingress-other-connection',
      connectionKey: 'app/other-connection',
    });
    expect(otherConnection.inserted).toBe(true);

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        repository.insertIngress({
          ...ingress('card_action', 'concurrent-card'),
          id: `concurrent-${index}`,
        }),
      ),
    );
    expect(results.filter((result) => result.inserted)).toHaveLength(1);
    expect(new Set(results.map((result) => result.record.id)).size).toBe(1);
  });

  it('keeps distinct Card clicks on one message while replaying the same click', async () => {
    const first = await repository.insertIngress({
      ...ingress('card_action', 'card-message-operator-accept-token-a'),
      externalMessageId: 'same-card-message',
      action: { action: 'accept', digest: 'hash-a' },
    });
    const second = await repository.insertIngress({
      ...ingress('card_action', 'card-message-operator-reject-token-b'),
      id: 'card-reject',
      externalMessageId: 'same-card-message',
      action: { action: 'reject', digest: 'hash-b' },
    });
    const replay = await repository.insertIngress({
      ...ingress('card_action', 'card-message-operator-accept-token-a'),
      id: 'card-replay',
      providerEventId: 'different-provider-event-on-replay',
      externalMessageId: 'same-card-message',
      action: { action: 'accept', digest: 'hash-a' },
    });
    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(true);
    expect(replay).toEqual({ inserted: false, record: first.record });
  });

  it('claims active leases once and reclaims expired ingress leases with attempts', async () => {
    await repository.insertIngress(ingress('message', 'lease-message'));
    const claimed = await repository.claimIngress('worker-a', 60_000);
    expect(claimed).toMatchObject({
      id: 'ingress-lease-message',
      status: 'processing',
      leaseOwner: 'worker-a',
      attemptCount: 1,
    });
    await expect(
      repository.claimIngress('worker-b', 60_000),
    ).resolves.toBeNull();

    await database.query(
      `UPDATE channel_ingress_events SET lease_expires_at = now() - interval '1 second'`,
    );
    await expect(
      repository.claimIngress('worker-b', 60_000),
    ).resolves.toMatchObject({
      leaseOwner: 'worker-b',
      attemptCount: 2,
    });
  });

  it('rejects inconsistent ingress lease states', async () => {
    await repository.insertIngress(ingress('message', 'state-ingress'));
    await expect(
      database.query(
        `UPDATE channel_ingress_events SET status = 'processing', lease_owner = NULL, lease_expires_at = NULL WHERE id = 'ingress-state-ingress'`,
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        `UPDATE channel_ingress_events SET lease_owner = 'worker' WHERE id = 'ingress-state-ingress'`,
      ),
    ).rejects.toThrow();
  });

  it('converges concurrent ingress claims to one owner', async () => {
    await repository.insertIngress(ingress('message', 'claim-concurrent'));
    const claims = await Promise.all(
      ['worker-a', 'worker-b', 'worker-c'].map((worker) =>
        repository.claimIngress(worker, 60_000),
      ),
    );
    expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
  });

  it('converges a unique connection/chat/root conversation binding', async () => {
    await repository.insertIngress(ingress('message', 'binding-ingress'));
    const input = {
      id: 'binding-a',
      connectionKey: 'app/connection',
      chatId: 'chat-1',
      rootMessageId: 'root-1',
      creatingIngressId: 'ingress-binding-ingress',
    };
    const results = await Promise.all([
      repository.resolveBinding(input),
      repository.resolveBinding({
        ...input,
        id: 'binding-b',
      }),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({
      id: 'binding-a',
      connectionKey: 'app/connection',
      chatId: 'chat-1',
      rootMessageId: 'root-1',
    });
    await expect(
      repository.resolveBinding({
        ...input,
        id: 'binding-conflict',
        creatingIngressId: 'ingress-other',
      }),
    ).rejects.toThrow(/conflict/);
  });

  it('isolates bindings by connection and converges concurrent callers', async () => {
    await repository.insertIngress(ingress('message', 'binding-isolation'));
    const base = {
      connectionKey: 'app/connection-a',
      chatId: 'chat-isolated',
      rootMessageId: 'root-isolated',
      creatingIngressId: 'ingress-binding-isolation',
    };
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        repository.resolveBinding({
          ...base,
          id: `binding-concurrent-${index}`,
        }),
      ),
    );
    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    const otherConnection = await repository.resolveBinding({
      ...base,
      id: 'binding-other-connection',
      connectionKey: 'app/connection-b',
    });
    expect(otherConnection.id).toBe('binding-other-connection');
  });

  it('converges outbox logical uniqueness and reclaims expired leases', async () => {
    const input = outbox('review-1');
    const first = await repository.saveOutbox(input);
    const duplicate = await repository.saveOutbox({
      ...input,
    });
    expect(first.inserted).toBe(true);
    expect(duplicate).toEqual({ inserted: false, record: first.record });
    await expect(
      repository.saveOutbox({
        ...input,
        id: 'outbox-conflict',
        payload: '{"text":"different"}',
      }),
    ).rejects.toThrow(/conflict/);
    const claimed = await repository.claimOutbox('delivery-a', 60_000);
    expect(claimed).toMatchObject({
      leaseOwner: 'delivery-a',
      attemptCount: 1,
    });
    await expect(
      repository.claimOutbox('delivery-b', 60_000),
    ).resolves.toBeNull();
    await database.query(
      `UPDATE channel_outbox SET lease_expires_at = now() - interval '1 second'`,
    );
    await expect(
      repository.claimOutbox('delivery-b', 60_000),
    ).resolves.toMatchObject({
      leaseOwner: 'delivery-b',
      attemptCount: 2,
    });
    await repository.saveOutbox(outbox('claim-concurrent-outbox'));
    const claims = await Promise.all(
      ['delivery-c', 'delivery-d', 'delivery-e'].map((worker) =>
        repository.claimOutbox(worker, 60_000),
      ),
    );
    expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
  });

  it('rejects inconsistent outbox lease states and requires retry timing', async () => {
    await repository.saveOutbox(outbox('state-outbox'));
    await expect(
      database.query(
        `UPDATE channel_outbox SET status = 'sending', lease_owner = NULL, lease_expires_at = NULL WHERE id = 'outbox-state-outbox'`,
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        `UPDATE channel_outbox SET lease_owner = 'worker' WHERE id = 'outbox-state-outbox'`,
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        `UPDATE channel_outbox SET status = 'retry_wait', next_attempt_at = NULL WHERE id = 'outbox-state-outbox'`,
      ),
    ).rejects.toThrow();
  });

  it.each([
    ['delivered', 'delivered'],
    ['retryable_failure', 'retry_wait'],
    ['permanent_failure', 'permanent_failed'],
    ['unknown', 'delivery_unknown'],
  ] as const)(
    'records %s delivery attempt and transitions outbox',
    async (result, status) => {
      const saved = await repository.saveOutbox(outbox(`attempt-${result}`));
      await repository.claimOutbox('delivery-worker', 60_000);
      await repository.recordAttempt({
        id: `attempt-${result}`,
        outboxId: saved.record.id,
        attemptNumber: 1,
        providerRequestId: `request-${result}`,
        result,
        ...(result === 'retryable_failure' || result === 'permanent_failure'
          ? { safeErrorCode: `safe-${result}` }
          : {}),
      });
      const row = await database.query<{ status: string }>(
        'SELECT status FROM channel_outbox WHERE id = $1',
        [saved.record.id],
      );
      expect(row.rows[0]?.status).toBe(status);
      const attempts = await database.query(
        'SELECT * FROM channel_delivery_attempts WHERE outbox_id = $1',
        [saved.record.id],
      );
      expect(attempts.rows).toHaveLength(1);
    },
  );

  it('makes exact delivery attempt replay idempotent and rejects conflicting replay', async () => {
    const saved = await repository.saveOutbox(outbox('attempt-replay'));
    await repository.claimOutbox('delivery-worker', 60_000);
    const attempt = {
      id: 'attempt-replay-1',
      outboxId: saved.record.id,
      attemptNumber: 1,
      providerRequestId: 'request-replay',
      result: 'delivered' as const,
    };
    await repository.recordAttempt(attempt);
    await expect(repository.recordAttempt(attempt)).resolves.toBeUndefined();
    await expect(
      repository.recordAttempt({
        ...attempt,
        id: 'attempt-conflict',
        result: 'unknown',
      }),
    ).rejects.toThrow(/conflict/);
    await expect(
      database.query<{ status: string }>(
        'SELECT status FROM channel_outbox WHERE id = $1',
        [saved.record.id],
      ),
    ).resolves.toMatchObject({ rows: [{ status: 'delivered' }] });
  });

  it('rolls back attempts and state when the outbox is not claimable or missing', async () => {
    const saved = await repository.saveOutbox(outbox('attempt-rollback'));
    await expect(
      repository.recordAttempt({
        id: 'attempt-rollback-1',
        outboxId: saved.record.id,
        attemptNumber: 1,
        result: 'delivered',
      }),
    ).rejects.toThrow();
    await expect(
      repository.recordAttempt({
        id: 'attempt-missing',
        outboxId: 'outbox-missing',
        attemptNumber: 1,
        result: 'delivered',
      }),
    ).rejects.toThrow();
    const attempts = await database.query(
      'SELECT * FROM channel_delivery_attempts WHERE outbox_id = $1',
      [saved.record.id],
    );
    expect(attempts.rows).toEqual([]);
    await expect(
      database.query<{ status: string }>(
        'SELECT status FROM channel_outbox WHERE id = $1',
        [saved.record.id],
      ),
    ).resolves.toMatchObject({ rows: [{ status: 'pending' }] });
  });

  it('rejects nested, array, and sensitive card action values before persistence', async () => {
    for (const action of [
      { action: { nested: true } },
      { action: ['accept'] },
      { callback_token: 'secret' },
      { secret: 'secret' },
      { raw_payload: 'raw' },
      { token: 'token' },
    ]) {
      await expect(
        repository.insertIngress({
          ...ingress('card_action', `unsafe-${Object.keys(action)[0]}`),
          action: action as Exclude<ChannelIngressInput['action'], undefined>,
        }),
      ).rejects.toThrow();
    }
  });

  it('rejects unsafe bounds and never accepts raw payload, callback token, raw error, or local path fields', async () => {
    const longMessage = Array.from(
      { length: 40 },
      (_, index) => `line ${index + 1}: ${'x'.repeat(20)}`,
    ).join('\n');
    expect(Buffer.byteLength(longMessage, 'utf8')).toBeGreaterThan(512);
    expect(Buffer.byteLength(longMessage, 'utf8')).toBeLessThanOrEqual(8192);
    await expect(
      repository.insertIngress(
        ingress('message', 'long-valid-text', { text: longMessage }),
      ),
    ).resolves.toMatchObject({ inserted: true });
    await expect(
      database.query<{ text: string }>(
        'SELECT text FROM channel_ingress_events WHERE external_key = $1',
        ['long-valid-text'],
      ),
    ).resolves.toMatchObject({ rows: [{ text: longMessage }] });
    await expect(
      repository.insertIngress(
        ingress('message', 'too-long', { text: 'x'.repeat(8193) }),
      ),
    ).rejects.toThrow(/text/);
    await expect(
      repository.insertIngress(
        ingress('card_action', 'too-large-action', {
          action: { content: 'x'.repeat(8193) },
        }),
      ),
    ).rejects.toThrow(/action/);
    await expect(
      repository.saveOutbox(outbox('too-large-payload', 'x'.repeat(8193))),
    ).rejects.toThrow(/payload/);
    await expect(
      repository.recordAttempt({
        id: 'bad-attempt',
        outboxId: 'missing',
        attemptNumber: 1,
        result: 'permanent_failure',
        safeErrorCode: 'x'.repeat(257),
      }),
    ).rejects.toThrow(/safeErrorCode/);

    const columns = await database.query<{ column_name: string }>(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name LIKE 'channel_%'
      `,
    );
    expect(columns.rows.map((row) => row.column_name)).not.toEqual(
      expect.arrayContaining([
        'raw_payload',
        'callback_token',
        'raw_error',
        'local_path',
      ]),
    );
  });
});

function ingress(
  kind: ChannelIngressInput['kind'],
  externalKey: string,
  values: Pick<ChannelIngressInput, 'text' | 'action'> = {},
): ChannelIngressInput {
  return {
    id: `ingress-${externalKey}`,
    connectionKey: 'app/connection',
    kind,
    externalKey,
    providerEventId: `event-${externalKey}`,
    externalMessageId: `message-${externalKey}`,
    chatId: 'chat-1',
    rootMessageId: 'root-1',
    threadId: 'thread-1',
    replyToId: 'reply-1',
    externalActorId: 'actor-1',
    normalizationVersion: 'lark-v1',
    ...values,
  };
}

function outbox(id: string, payload = '{"text":"safe"}'): ChannelOutboxInput {
  return {
    id: `outbox-${id}`,
    connectionKey: 'app/connection',
    bindingId: null,
    targetId: 'chat-1',
    deliveryKind: 'message',
    aggregateId: id,
    aggregateVersion: 1,
    payload,
    providerRequestId: `provider-${id}`,
  };
}
