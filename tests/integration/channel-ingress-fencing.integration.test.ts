import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { applyDurableKernelMigrations } from '../../src/infrastructure/postgres/postgres.js';
import { PostgresChannelRepository } from '../../src/infrastructure/postgres/postgres-channel-repository.js';

describe('channel ingress claim fencing', () => {
  it('releases a post-canonical failure for exact retry and rejects stale completion', async () => {
    const db = new PGlite();
    await applyDurableKernelMigrations(db);
    const repository = new PostgresChannelRepository(db);
    await repository.insertIngress({
      id: 'fenced-ingress',
      connectionKey: 'lark',
      kind: 'card_action',
      externalKey: 'fenced-ingress',
      externalMessageId: 'card',
      chatId: 'chat',
      normalizationVersion: 'v1',
    });
    const first = await repository.claimIngress('worker-1', 30_000);
    expect(first?.attemptCount).toBe(1);
    await repository.releaseIngress({
      ingressId: 'fenced-ingress',
      leaseOwner: 'worker-1',
      attemptNumber: 1,
      safeErrorCode: 'retryable_projection',
    });
    expect(
      (
        await db.query<any>(
          'SELECT status,lease_owner,attempt_count FROM channel_ingress_events WHERE id=$1',
          ['fenced-ingress'],
        )
      ).rows[0],
    ).toMatchObject({ status: 'pending', lease_owner: null, attempt_count: 1 });
    const second = await repository.claimIngress('worker-2', 30_000);
    expect(second?.attemptCount).toBe(2);
    await expect(
      repository.completeIngress({
        ingressId: 'fenced-ingress',
        status: 'failed',
        safeErrorCode: 'stale',
        leaseOwner: 'worker-1',
        attemptNumber: 1,
      }),
    ).rejects.toThrow('fence');
    expect(
      (
        await db.query<any>(
          'SELECT status,lease_owner,attempt_count FROM channel_ingress_events WHERE id=$1',
          ['fenced-ingress'],
        )
      ).rows[0],
    ).toMatchObject({
      status: 'processing',
      lease_owner: 'worker-2',
      attempt_count: 2,
    });
    await db.close();
  });
});
