import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalFileStore } from './local-file-store.js';

describe('LocalFileStore', () => {
  it('fails closed for a missing or mismatched pinned snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-memory-'));
    try {
      const store = new LocalFileStore(root);
      await store
        .publish({
          tenantId: 'tenant',
          workspaceId: 'workspace',
          snapshotId: 'snapshot-v1',
          memory: 'v1',
          manifest: JSON.stringify({ content_hash: 'wrong' }),
          contentHash:
            '3bfc269594ef649228e9a74bab00f0426c2f6f6f7f0c7e2f4f6b6f8e8f8f8f8f',
        })
        .catch(() => undefined);
      await expect(
        store.readVerified({
          tenantId: 'tenant',
          workspaceId: 'workspace',
          snapshotId: 'missing',
          expectedContentHash: 'hash',
        }),
      ).rejects.toThrow('Memory snapshot verification failed');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
