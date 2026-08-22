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
    const database = {
      query: db.query.bind(db),
      async connect() {
        return {
          query: db.query.bind(db),
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

    const rows = await db.query<{ transition_no: number; product_state: string }>(
      `SELECT transition_no::int, product_state
       FROM work_chat_wake_outbox
       WHERE tenant_id='tenant-n2'
       ORDER BY transition_no`,
    );
    expect(rows.rows).toEqual([
      { transition_no: 1, product_state: 'needs_you' },
      { transition_no: 3, product_state: 'needs_you' },
    ]);
    await db.close();
  });
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
