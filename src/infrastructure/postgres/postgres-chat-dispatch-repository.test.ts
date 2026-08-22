import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

import { applyDurableKernelMigrations } from './postgres.js';
import { PostgresChatDispatchRepository } from './postgres-chat-dispatch-repository.js';

const conversationId = '00000000-0000-4000-8000-00000000d201';
const runtimeId = '00000000-0000-4000-8000-00000000d301';

describe('PostgresChatDispatchRepository N2 activation semantics', () => {
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
