import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

import {
  workContextScope,
  agentUserContextScope,
} from '../../domain/context/context-fs.js';
import { principalRef } from '../../domain/tenancy/product-context.js';
import { applyDurableKernelMigrations } from './postgres.js';
import { PostgresLogicalFileStore } from './postgres-logical-file-store.js';

describe('PostgresLogicalFileStore', () => {
  it('shares one Work scope independently of the Agent viewing it', async () => {
    const db = new PGlite();
    await applyDurableKernelMigrations(db);
    const files = new PostgresLogicalFileStore(db);
    const scope = workContextScope({
      tenantId: 'tenant-context',
      workspaceId: 'workspace-context',
      workId: 'work-17',
    });

    await files.write({ scope, path: 'report.md', content: 'draft one' });
    await files.write({ scope, path: 'report.md', content: 'draft two' });

    await expect(files.read(scope, 'report.md')).resolves.toMatchObject({
      currentVersion: 2,
      content: 'draft two',
    });
    const snapshots = await db.query<{ version: number }>(
      `SELECT s.version FROM context_entry_snapshots s
       JOIN context_entries e ON e.id=s.entry_id
       WHERE e.tenant_id=$1 AND e.scope_kind='work' AND e.scope_key=$2
       ORDER BY s.version`,
      ['tenant-context', 'workspace-context:work-17'],
    );
    expect(snapshots.rows).toEqual([{ version: 1 }, { version: 2 }]);
    await db.close();
  });

  it('isolates agent-user scopes for different principals', async () => {
    const db = new PGlite();
    await applyDurableKernelMigrations(db);
    const files = new PostgresLogicalFileStore(db);
    const alice = agentUserContextScope({
      tenantId: 'tenant-context',
      agentDefinitionId: 'agent-shared',
      principal: principalRef({ principalType: 'user', principalId: 'alice' }),
    });
    const bob = agentUserContextScope({
      tenantId: 'tenant-context',
      agentDefinitionId: 'agent-shared',
      principal: principalRef({ principalType: 'user', principalId: 'bob' }),
    });

    await files.write({
      scope: alice,
      path: 'prefs.md',
      content: 'alice prefs',
    });
    await files.write({ scope: bob, path: 'prefs.md', content: 'bob prefs' });

    await expect(files.read(alice, 'prefs.md')).resolves.toMatchObject({
      content: 'alice prefs',
    });
    await expect(files.read(bob, 'prefs.md')).resolves.toMatchObject({
      content: 'bob prefs',
    });
    await db.close();
  });
});
