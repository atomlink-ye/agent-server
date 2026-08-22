import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

import { applyDurableKernelMigrations } from './postgres.js';
import { PostgresWorkChatWakeStateRepository } from './postgres-work-chat-wake-state-repository.js';

const conversationId = '00000000-0000-4000-8000-00000000e201';

describe('PostgresWorkChatWakeStateRepository N2 wake identity', () => {
  it('queues two legitimate needs_you wakes across an intervening running state', async () => {
    const db = new PGlite();
    await applyDurableKernelMigrations(db);
    const now = '2026-08-22T00:00:00.000Z';
    await db.query(
      `INSERT INTO conversations
        (id,tenant_id,kind,direct_pair_key,next_sequence,created_at,updated_at)
       VALUES($1,'tenant-n2','direct','direct:work-wake-n2',1,$2,$2)`,
      [conversationId, now],
    );
    // The production repository uses pg.Pool.connect() to pin BEGIN/COMMIT to
    // one connection. PGlite is a single embedded connection, so this adapter
    // gives it the same shape without changing the repository semantics.
    // PGlite exposes affectedRows (rather than pg's rowCount). Keep this
    // adapter deliberately rowCount-free so both scoped UPDATE mutations use
    // the compatibility guard exercised by this identity-pair assertion.
    const query = async <Row = Record<string, unknown>>(
      sql: string,
      values?: readonly unknown[],
    ) => {
      const result = await db.query<Row>(sql, values as unknown[] | undefined);
      return { rows: result.rows, affectedRows: result.affectedRows };
    };
    const database = {
      query,
      async connect() {
        return {
          query,
          release() {},
        };
      },
    };
    const repository = new PostgresWorkChatWakeStateRepository(database as any);
    const key = {
      tenantId: 'tenant-n2',
      workspaceId: '00000000-0000-4000-8000-00000000e301',
      workId: '00000000-0000-4000-8000-00000000e401',
    };

    await expect(
      repository.observe({
        key,
        card: card('needs_you'),
        conversationId,
        observedAt: '2026-08-22T00:00:01.000Z',
      }),
    ).resolves.toBe('queued');
    await expect(
      repository.observe({
        key,
        card: card('running'),
        conversationId: null,
        observedAt: '2026-08-22T00:00:02.000Z',
      }),
    ).resolves.toBe('recorded');
    await expect(
      repository.observe({
        key,
        card: card('needs_you'),
        conversationId,
        observedAt: '2026-08-22T00:00:03.000Z',
      }),
    ).resolves.toBe('queued');

    const rows = await db.query<{
      transition_no: number;
      product_state: string;
    }>(
      `SELECT transition_no::int, product_state
       FROM work_chat_wake_outbox
       WHERE tenant_id='tenant-n2'
       ORDER BY transition_no`,
    );
    expect(rows.rows).toEqual([
      { transition_no: 1, product_state: 'needs_you' },
      { transition_no: 3, product_state: 'needs_you' },
    ]);
    const state = await db.query<{
      last_observed_state: string;
      transition_no: number;
    }>(
      `SELECT last_observed_state, transition_no::int
       FROM work_chat_wake_states
       WHERE tenant_id='tenant-n2' AND workspace_id=$1 AND work_id=$2`,
      [key.workspaceId, key.workId],
    );
    expect(state.rows).toEqual([
      { last_observed_state: 'needs_you', transition_no: 3 },
    ]);
    const delivery = await repository.claimPending('n2-test-worker', 60_000);
    expect(delivery).not.toBeNull();
    await expect(
      repository.markDelivered(delivery!.deliveryId, 'n2-test-worker'),
    ).resolves.toBeUndefined();
    await db.close();
  }, 15_000);
});

function card(productState: 'running' | 'needs_you') {
  return {
    workId: '00000000-0000-4000-8000-00000000e401',
    workRef: 'W-E401',
    title: 'N2 attention loop',
    productState,
    problemKind: null,
    attentionReason:
      productState === 'needs_you' ? 'completion_approval_pending' : null,
    resultSummary: null,
    resultCaptureStatus: 'not_present',
  } as any;
}
