import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

import { applyDurableKernelMigrations } from './postgres.js';
import { PostgresChatDispatchRepository } from './postgres-chat-dispatch-repository.js';
import type {
  PostgresConnectable,
  PostgresQueryable,
} from './postgres-conversation-repository.js';

const conversationId = '00000000-0000-4000-8000-00000000d201';
const runtimeId = '00000000-0000-4000-8000-00000000d301';

describe('PostgresChatDispatchRepository N2 activation semantics', () => {
  it('uses a connection-scoped claim statement identity for pool-backed databases', async () => {
    const statements: Array<Record<string, unknown>> = [];
    const client = {
      async query(
        sqlOrConfig: string | Record<string, unknown>,
        _values?: readonly unknown[],
      ) {
        if (typeof sqlOrConfig !== 'string') statements.push(sqlOrConfig);
        return { rows: [] };
      },
      release() {},
    };
    const repository = new PostgresChatDispatchRepository({
      async query() {
        throw new Error('claim should use the leased connection');
      },
      async connect() {
        return client;
      },
    } as PostgresConnectable);

    await repository.claimNext('worker-a', 60_000);

    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatchObject({
      name: expect.stringMatching(/^agent_server_chat_claim_/),
      portal: expect.stringMatching(/^agent_server_chat_claim_portal_/),
      values: ['worker-a', 60_000],
    });
    expect(statements[0]?.text).toEqual(
      expect.stringContaining('claimed_by=$1'),
    );
  });

  it('coalesces an unclaimed user message and Work wake without dropping either cause', async () => {
    const db = await database();
    const repository = new PostgresChatDispatchRepository(db);

    await repository.enqueue({
      tenantId: 'tenant-n2',
      agentDefinitionId: 'agent-n2',
      conversationId,
      throughSequence: 1,
      dedupeKey: 'message:m1',
      cause: {
        type: 'unread_message',
        conversationId,
        throughSequence: 1,
        messageId: 'm1',
      },
    });
    await repository.enqueue({
      tenantId: 'tenant-n2',
      agentDefinitionId: 'agent-n2',
      conversationId,
      throughSequence: 2,
      dedupeKey: 'work-wake:17',
      cause: {
        type: 'work_wake',
        conversationId,
        throughSequence: 2,
        deliveryId: '17',
        workId: 'work-17',
        workRef: 'W-17',
        productState: 'needs_you',
      },
      priority: 'urgent',
    });

    const pending = await repository.listPending(10);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      throughSequence: 2,
      priority: 'urgent',
    });
    expect(pending[0]?.causes).toEqual([
      expect.objectContaining({ type: 'unread_message', throughSequence: 1 }),
      expect.objectContaining({
        type: 'work_wake',
        throughSequence: 2,
        deliveryId: '17',
        workRef: 'W-17',
      }),
    ]);

    const duplicate = await repository.enqueue({
      tenantId: 'tenant-n2',
      agentDefinitionId: 'agent-n2',
      conversationId,
      throughSequence: 2,
      dedupeKey: 'work-wake:17',
      cause: {
        type: 'work_wake',
        conversationId,
        throughSequence: 2,
        deliveryId: '17',
        workId: 'work-17',
        workRef: 'W-17',
        productState: 'needs_you',
      },
    });
    expect(duplicate.enqueued).toBe(false);

    await db.close();
  });

  it('freezes a claimed activation so a later event opens the next activation', async () => {
    const db = await database();
    const repository = new PostgresChatDispatchRepository(db);
    await repository.enqueue({
      tenantId: 'tenant-n2',
      agentDefinitionId: 'agent-n2',
      conversationId,
      throughSequence: 1,
      dedupeKey: 'message:first',
    });
    const claimed = await repository.claimNext('worker-a', 60_000);
    expect(claimed).not.toBeNull();

    const second = await repository.enqueue({
      tenantId: 'tenant-n2',
      agentDefinitionId: 'agent-n2',
      conversationId,
      throughSequence: 2,
      dedupeKey: 'message:second',
    });
    expect(second.enqueued).toBe(true);
    expect(second.dispatchId).not.toBe(claimed?.id);
    const pending = await repository.listPending(10);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.throughSequence).toBe(2);

    await db.close();
  });

  it('holds a released activation behind its retry backoff', async () => {
    const db = await database();
    const repository = new PostgresChatDispatchRepository(withRowCount(db));
    await repository.enqueue({
      tenantId: 'tenant-n2',
      agentDefinitionId: 'agent-n2',
      conversationId,
      throughSequence: 1,
      dedupeKey: 'message:first',
    });

    const claimed = await repository.claimNext('worker-a', 60_000);
    expect(claimed?.attemptCount).toBe(1);
    expect(
      await repository.releaseClaim({
        id: claimed!.id,
        workerId: 'worker-a',
        retryDelayMs: 60_000,
        errorName: 'ExecutionPlaneUnavailableError',
      }),
    ).toBe(true);

    // The row is released, but not claimable again in the same instant.
    expect(await repository.claimNext('worker-a', 60_000)).toBeNull();
    expect(await repository.listPending(10)).toHaveLength(0);
    const row = await db.query<{
      available_at: string | Date;
      last_error_name: string | null;
      attempt_count: number;
    }>(
      `SELECT available_at,last_error_name,attempt_count
       FROM chat_dispatches WHERE id=$1`,
      [claimed!.id],
    );
    expect(row.rows[0]?.last_error_name).toBe('ExecutionPlaneUnavailableError');
    expect(Number(row.rows[0]?.attempt_count)).toBe(1);

    // Once the backoff has elapsed the same activation is retried, not lost.
    await db.query(
      `UPDATE chat_dispatches SET available_at=NOW() - INTERVAL '1 second' WHERE id=$1`,
      [claimed!.id],
    );
    const retried = await repository.claimNext('worker-a', 60_000);
    expect(retried?.id).toBe(claimed!.id);
    expect(retried?.attemptCount).toBe(2);

    await db.close();
  });

  it('parks a dead-lettered activation without blocking the next one', async () => {
    const db = await database();
    const repository = new PostgresChatDispatchRepository(withRowCount(db));
    await repository.enqueue({
      tenantId: 'tenant-n2',
      agentDefinitionId: 'agent-n2',
      conversationId,
      throughSequence: 1,
      dedupeKey: 'message:first',
    });
    const claimed = await repository.claimNext('worker-a', 60_000);

    expect(
      await repository.deadLetterClaim({
        id: claimed!.id,
        workerId: 'worker-a',
        reason: 'attempt_limit_exhausted',
        errorName: 'RuntimeTurnExecutionError',
      }),
    ).toBe(true);

    // Terminal for automatic retry, still inspectable and unpublished.
    expect(await repository.claimNext('worker-a', 60_000)).toBeNull();
    expect(await repository.listPending(10)).toHaveLength(0);
    const parked = await db.query<{
      dead_letter_reason: string | null;
      dead_lettered_at: string | Date | null;
      published_at: string | Date | null;
    }>(
      `SELECT dead_letter_reason,dead_lettered_at,published_at
       FROM chat_dispatches WHERE id=$1`,
      [claimed!.id],
    );
    expect(parked.rows[0]?.dead_letter_reason).toBe('attempt_limit_exhausted');
    expect(parked.rows[0]?.dead_lettered_at).not.toBeNull();
    expect(parked.rows[0]?.published_at).toBeNull();

    // A later cause must open a new activation rather than joining the parked one.
    const next = await repository.enqueue({
      tenantId: 'tenant-n2',
      agentDefinitionId: 'agent-n2',
      conversationId,
      throughSequence: 2,
      dedupeKey: 'message:second',
    });
    expect(next.enqueued).toBe(true);
    expect(next.dispatchId).not.toBe(claimed!.id);
    const claimedNext = await repository.claimNext('worker-a', 60_000);
    expect(claimedNext?.id).toBe(next.dispatchId);
    expect(claimedNext?.throughSequence).toBe(2);

    await db.close();
  });

  it('keeps the per-epoch conversation watermark monotonic', async () => {
    const db = await database();
    const repository = new PostgresChatDispatchRepository(db);
    expect(
      await repository.getRuntimeWatermark({
        agentChatRuntimeId: runtimeId,
        runtimeEpoch: 2,
        tenantId: 'tenant-n2',
        conversationId,
      }),
    ).toBe(0);
    expect(
      await repository.advanceRuntimeWatermark({
        agentChatRuntimeId: runtimeId,
        runtimeEpoch: 2,
        tenantId: 'tenant-n2',
        conversationId,
        throughSequence: 7,
      }),
    ).toBe(7);
    expect(
      await repository.advanceRuntimeWatermark({
        agentChatRuntimeId: runtimeId,
        runtimeEpoch: 2,
        tenantId: 'tenant-n2',
        conversationId,
        throughSequence: 4,
      }),
    ).toBe(7);

    await db.close();
  });
});

/**
 * PGlite reports `affectedRows` where `pg` reports `rowCount`. Production runs
 * over the wire protocol, so keep the shim in the test rather than the adapter.
 */
function withRowCount(db: PGlite): PostgresQueryable {
  return {
    async query(sql: string, values?: readonly unknown[]) {
      const result = await db.query(sql, values ? [...values] : undefined);
      return {
        rows: result.rows as readonly Record<string, unknown>[],
        rowCount: result.affectedRows ?? null,
      };
    },
  } as PostgresQueryable;
}

async function database(): Promise<PGlite> {
  const db = new PGlite();
  await applyDurableKernelMigrations(db);
  const now = '2026-08-22T00:00:00.000Z';
  await db.query(
    `INSERT INTO conversations
      (id,tenant_id,kind,title,topic,direct_pair_key,next_sequence,created_at,updated_at)
     VALUES($1,'tenant-n2','direct',NULL,NULL,'direct:n2',1,$2,$2)`,
    [conversationId, now],
  );
  await db.query(
    `INSERT INTO agent_chat_runtimes
      (id,tenant_id,agent_definition_id,active_agent_version_id,epoch,status,created_at,updated_at)
     VALUES($1,'tenant-n2','agent-n2','version-n2',2,'available',$2,$2)`,
    [runtimeId, now],
  );
  return db;
}
