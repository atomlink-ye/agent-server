import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

import { applyDurableKernelMigrations } from '../../src/infrastructure/postgres/postgres.js';

const definitionId = '00000000-0000-4000-8000-0000000b0001';
const versionId = '00000000-0000-4000-8000-0000000b0101';
const now = '2026-07-23T10:00:00.000Z';

async function database(): Promise<PGlite> {
  const db = new PGlite();
  await applyDurableKernelMigrations(db);
  return db;
}

async function insertManagedDefinition(
  db: PGlite,
  id: string = definitionId,
  workspaceId = 'workspace_one',
  name = 'my-agent',
  tenantId = 'tenant_one',
  principalId = 'principal_one',
): Promise<void> {
  await db.query(
    `INSERT INTO agent_definitions
      (id, tenant_id, workspace_id, principal_type, principal_id, name, managed_discriminator, normalized_name, created_at, updated_at)
     VALUES ($1, $5, $2, 'service_account', $6, $3, 'managed_agent_v1', $3, $4, $4)`,
    [id, workspaceId, name, now, tenantId, principalId],
  );
}

async function insertManagedVersion(
  db: PGlite,
  id: string = versionId,
  fingerprint = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  status = 'draft',
): Promise<void> {
  await db.query(
    `INSERT INTO agent_versions
      (id, definition_id, tenant_id, workspace_id, principal_type, principal_id, status, name, description, instructions,
       managed_discriminator, canonical_package, fingerprint, pattern_metadata, compiler_metadata, policy_snapshot,
       reference_snapshot, tool_skill_snapshot, validation_report, compiled_package, execution_snapshot,
       created_at, updated_at, published_at)
     VALUES ($1, $2, 'tenant_one', 'workspace_one', 'service_account', 'principal_one', $3, 'Agent v1', 'desc', 'instructions',
       'managed_agent_v1', '{"spec":"canonical"}', $4, '{"pattern":"p"}', '{"compiler":"c"}', '{"policy":"v1"}',
       '{"refs":[]}', '{"tools":[],"skills":[]}', '{"valid":true}', '{"compiled":true}', '{"mode":"managed"}',
       $5, $5, NULL)`,
    [id, definitionId, status, fingerprint, now],
  );
}

describe('managed agent registry migration', () => {
  it('applies migration 0005 after migrations 0001 through 0004', async () => {
    const db = await database();
    const rows = await db.query<{ version: string }>(
      'SELECT version FROM durable_kernel_schema_migrations ORDER BY version',
    );
    expect(rows.rows.map((row) => row.version)).toEqual([
      '0001_durable_kernel_a',
      '0002_phase_2a_authenticated_admission',
      '0003_sequential_team_mvp',
      '0004_workspace_memory_proposal_mvp',
      '0005_managed_agent_registry_b',
    ]);
  });

  it('uniquifies managed owners by tenant, principal, and normalized name, not workspace', async () => {
    const db = await database();
    await insertManagedDefinition(db);
    await expect(
      insertManagedDefinition(
        db,
        '00000000-0000-4000-8000-0000000b0002',
        'workspace_two',
      ),
    ).rejects.toThrow(/unique/i);
    await insertManagedDefinition(
      db,
      '00000000-0000-4000-8000-0000000b0003',
      'workspace_two',
      'other-agent',
    );
    await insertManagedDefinition(
      db,
      '00000000-0000-4000-8000-0000000b0004',
      'workspace_two',
      'my-agent',
      'tenant_two',
    );
    await insertManagedDefinition(
      db,
      '00000000-0000-4000-8000-0000000b0005',
      'workspace_two',
      'my-agent',
      'tenant_one',
      'principal_two',
    );
  });

  it('leaves legacy definitions and duplicate behavior unaffected', async () => {
    const db = await database();
    const values = (id: string, workspace: string) => [id, workspace, now];
    const sql = `INSERT INTO agent_definitions
      (id, tenant_id, workspace_id, principal_type, principal_id, name, description, created_at, updated_at)
      VALUES ($1, 'legacy_tenant', $2, 'user', 'legacy_user', 'Same Name', NULL, $3, $3)`;
    await db.query(
      sql,
      values('00000000-0000-4000-8000-0000000b0021', 'legacy_one'),
    );
    await db.query(
      sql,
      values('00000000-0000-4000-8000-0000000b0022', 'legacy_two'),
    );
  });

  it('converges equal managed canonical packages by definition and fingerprint', async () => {
    const db = await database();
    await insertManagedDefinition(db);
    await insertManagedVersion(db);
    await expect(
      insertManagedVersion(db, '00000000-0000-4000-8000-0000000b0102'),
    ).rejects.toThrow(/unique/i);
  });

  it('scopes idempotency by tenant and principal, distinguishes operation, and excludes workspace', async () => {
    const db = await database();
    await db.query(
      `INSERT INTO agent_registry_idempotency
      (operation, tenant_id, principal_type, principal_id, idempotency_key, request_fingerprint, created_at, updated_at)
      VALUES ('import', 'tenant_one', 'service_account', 'principal_one', 'same-key', 'fp-1', $1, $1)`,
      [now],
    );
    await expect(
      db.query(
        `INSERT INTO agent_registry_idempotency
      (operation, tenant_id, principal_type, principal_id, idempotency_key, request_fingerprint, created_at, updated_at)
      VALUES ('import', 'tenant_one', 'service_account', 'principal_one', 'same-key', 'fp-2', $1, $1)`,
        [now],
      ),
    ).rejects.toThrow(/unique/i);
    await db.query(
      `INSERT INTO agent_registry_idempotency
      (operation, tenant_id, principal_type, principal_id, idempotency_key, request_fingerprint, created_at, updated_at)
      VALUES ('publish', 'tenant_one', 'service_account', 'principal_one', 'same-key', 'fp-2', $1, $1)`,
      [now],
    );
  });

  it('enforces managed immutable content and allows exactly one draft-to-published transition', async () => {
    const db = await database();
    await insertManagedDefinition(db);
    await insertManagedVersion(db);
    await expect(
      db.query(
        `UPDATE agent_versions SET instructions = 'changed' WHERE id = $1`,
        [versionId],
      ),
    ).rejects.toThrow(/immutable/i);
    await db.query(
      `UPDATE agent_versions SET status = 'published', published_at = $2, updated_at = $2 WHERE id = $1`,
      [versionId, '2026-07-23T10:01:00.000Z'],
    );
    const published = await db.query(
      `SELECT status, instructions, fingerprint, updated_at, published_at FROM agent_versions WHERE id = $1`,
      [versionId],
    );
    await expect(
      db.query(
        `UPDATE agent_versions SET status = 'draft', instructions = 'changed' WHERE id = $1`,
        [versionId],
      ),
    ).rejects.toThrow(/immutable/i);
    expect(published.rows[0]).toMatchObject({
      status: 'published',
      instructions: 'instructions',
      fingerprint:
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
  });

  it('rejects malformed managed and idempotency rows and exposes cursor indexes', async () => {
    const db = await database();
    await expect(
      db.query(
        `INSERT INTO agent_definitions
      (id, tenant_id, workspace_id, principal_type, principal_id, name, managed_discriminator, normalized_name, created_at, updated_at)
      VALUES ('00000000-0000-4000-8000-0000000b0099', 't', 'w', 'p', 'i', 'bad', 'managed_agent_v1', NULL, $1, $1)`,
        [now],
      ),
    ).rejects.toThrow(/check|null/i);
    await expect(
      db.query(
        `INSERT INTO agent_registry_idempotency
      (operation, tenant_id, principal_type, principal_id, idempotency_key, request_fingerprint, created_at, updated_at)
      VALUES ('invalid', 't', 'p', 'i', 'k', 'fp', $1, $1)`,
        [now],
      ),
    ).rejects.toThrow(/check|operation/i);
    const indexes = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename IN ('agent_definitions', 'agent_versions')`,
    );
    expect(indexes.rows.map((row) => row.indexname).join(' ')).toMatch(
      /cursor|owner|fingerprint/i,
    );
  });
});
