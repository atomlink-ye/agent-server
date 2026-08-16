import { describe, expect, it, vi } from 'vitest';

import { PostgresWorkRunResourceManifestRead } from './postgres-work-run-resource-manifest-read.js';

describe('PostgresWorkRunResourceManifestRead', () => {
  it('returns no Work manifest for a legacy compatibility task without UUID/text SQL failure', async () => {
    const query = vi.fn(async (sql: string) => {
      expect(sql).toContain('wr.workspace_id::text=root.workspace_id');
      return { rows: [] };
    });
    const reader = new PostgresWorkRunResourceManifestRead({ query });

    await expect(
      reader.findByRootTaskId('root-task', {
        tenantId: 'tenant',
        workspaceId: 'legacy-workspace',
        principalType: 'service_account',
        principalId: 'principal',
      }),
    ).resolves.toBeNull();
    expect(query).toHaveBeenCalledOnce();
  });
});
