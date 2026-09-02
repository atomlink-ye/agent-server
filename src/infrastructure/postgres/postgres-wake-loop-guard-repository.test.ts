import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

import { applyDurableKernelMigrations } from './postgres.js';
import { PostgresWakeLoopGuardRepository } from './postgres-wake-loop-guard-repository.js';

const key = {
  tenantId: 'tenant-loop-guard',
  workspaceId: '00000000-0000-4000-8000-00000000f001',
  workItemId: '00000000-0000-4000-8000-00000000f002',
};

describe('PostgresWakeLoopGuardRepository', () => {
  it('increments the counter across agent-caused wakes and resets it on a human-caused wake', async () => {
    const db = new PGlite();
    await applyDurableKernelMigrations(db);
    const repository = new PostgresWakeLoopGuardRepository(db as any);

    await expect(
      repository.observeWake({ ...key, causedByHuman: false }),
    ).resolves.toEqual({ agentWakeCount: 1 });
    await expect(
      repository.observeWake({ ...key, causedByHuman: false }),
    ).resolves.toEqual({ agentWakeCount: 2 });
    await expect(
      repository.observeWake({ ...key, causedByHuman: true }),
    ).resolves.toEqual({ agentWakeCount: 0 });
    await expect(
      repository.observeWake({ ...key, causedByHuman: false }),
    ).resolves.toEqual({ agentWakeCount: 1 });
  });

  it('keeps separate counters per WorkItem', async () => {
    const db = new PGlite();
    await applyDurableKernelMigrations(db);
    const repository = new PostgresWakeLoopGuardRepository(db as any);
    const otherKey = {
      ...key,
      workItemId: '00000000-0000-4000-8000-00000000f003',
    };

    await repository.observeWake({ ...key, causedByHuman: false });
    await repository.observeWake({ ...key, causedByHuman: false });

    await expect(
      repository.observeWake({ ...otherKey, causedByHuman: false }),
    ).resolves.toEqual({ agentWakeCount: 1 });
  });
});
