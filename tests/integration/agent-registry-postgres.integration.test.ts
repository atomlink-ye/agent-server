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
  await insertVersionWithOptions(db, { id, fingerprint, status });
}

interface ManagedVersionOptions {
  readonly id?: string;
  readonly fingerprint?: string | null;
  readonly status?: string;
  readonly managedDiscriminator?: string | null;
  readonly canonicalPackage?: string | null;
  readonly patternMetadata?: string | null;
  readonly compilerMetadata?: string | null;
  readonly policySnapshot?: string | null;
  readonly referenceSnapshot?: string | null;
  readonly toolSkillSnapshot?: string | null;
  readonly validationReport?: string | null;
  readonly compiledPackage?: string | null;
  readonly executionSnapshot?: string | null;
  readonly definitionId?: string;
}

async function insertVersionWithOptions(
  db: PGlite,
  options: ManagedVersionOptions = {},
): Promise<void> {
  await db.query(
    `INSERT INTO agent_versions
      (id, definition_id, tenant_id, workspace_id, principal_type, principal_id, status, name, description, instructions,
       managed_discriminator, canonical_package, fingerprint, pattern_metadata, compiler_metadata, policy_snapshot,
       reference_snapshot, tool_skill_snapshot, validation_report, compiled_package, execution_snapshot,
       created_at, updated_at, published_at)
     VALUES ($1, $2, 'tenant_one', 'workspace_one', 'service_account', 'principal_one', $3, 'Agent v1', 'desc', 'instructions',
       $4, $5::jsonb, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb,
       $15, $15, NULL)`,
    [
      options.id ?? versionId,
      options.definitionId ?? definitionId,
      options.status ?? 'draft',
      options.managedDiscriminator === undefined
        ? 'managed_agent_v1'
        : options.managedDiscriminator,
      options.canonicalPackage === undefined
        ? '{"spec":"canonical"}'
        : options.canonicalPackage,
      options.fingerprint === undefined
        ? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
        : options.fingerprint,
      options.patternMetadata === undefined
        ? '{"pattern":"p"}'
        : options.patternMetadata,
      options.compilerMetadata === undefined
        ? '{"compiler":"c"}'
        : options.compilerMetadata,
      options.policySnapshot === undefined
        ? '{"policy":"v1"}'
        : options.policySnapshot,
      options.referenceSnapshot === undefined
        ? '{"refs":[]}'
        : options.referenceSnapshot,
      options.toolSkillSnapshot === undefined
        ? '{"tools":[],"skills":[]}'
        : options.toolSkillSnapshot,
      options.validationReport === undefined
        ? '{"valid":true}'
        : options.validationReport,
      options.compiledPackage === undefined
        ? '{"compiled":true}'
        : options.compiledPackage,
      options.executionSnapshot === undefined
        ? '{"mode":"managed"}'
        : options.executionSnapshot,
      now,
    ],
  );
}

async function insertLegacyDefinition(
  db: PGlite,
  id = definitionId,
): Promise<void> {
  await db.query(
    `INSERT INTO agent_definitions
      (id, tenant_id, workspace_id, principal_type, principal_id, name, description, created_at, updated_at)
     VALUES ($1, 'tenant_one', 'workspace_one', 'service_account', 'principal_one', 'Legacy Agent', NULL, $2, $2)`,
    [id, now],
  );
}

async function insertLegacyVersion(db: PGlite, id = versionId): Promise<void> {
  await db.query(
    `INSERT INTO agent_versions
      (id, definition_id, tenant_id, workspace_id, principal_type, principal_id, status, name, description, instructions, created_at, updated_at, published_at)
     VALUES ($1, $2, 'tenant_one', 'workspace_one', 'service_account', 'principal_one', 'draft', 'Legacy Agent v1', NULL, 'legacy instructions', $3, $3, NULL)`,
    [id, definitionId, now],
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

  it('rejects converting a legacy version into a managed version by UPDATE', async () => {
    const db = await database();
    await insertLegacyDefinition(db);
    await insertLegacyVersion(db);
    await expect(
      db.query(
        `UPDATE agent_versions SET
          status = 'published', published_at = $2, updated_at = $2,
          managed_discriminator = 'managed_agent_v1', canonical_package = '{"spec":"canonical"}',
          fingerprint = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          pattern_metadata = '{"pattern":"p"}', compiler_metadata = '{"compiler":"c"}',
          policy_snapshot = '{"policy":"v1"}', reference_snapshot = '{"refs":[]}',
          tool_skill_snapshot = '{"tools":[],"skills":[]}', validation_report = '{"valid":true}',
          compiled_package = '{"compiled":true}', execution_snapshot = '{"mode":"managed"}'
         WHERE id = $1`,
        [versionId, '2026-07-23T10:01:00.000Z'],
      ),
    ).rejects.toThrow(/managed|immutable|insert/i);
    const row = await db.query(
      'SELECT managed_discriminator FROM agent_versions WHERE id = $1',
      [versionId],
    );
    expect(row.rows[0]).toEqual({ managed_discriminator: null });
  });

  it('requires managed versions to reference managed definitions', async () => {
    const db = await database();
    await insertLegacyDefinition(db);
    await expect(insertManagedVersion(db)).rejects.toThrow(
      /foreign|managed|definition/i,
    );
  });

  it.each([
    ['canonical package', { canonicalPackage: null }],
    ['fingerprint', { fingerprint: null }],
    ['pattern metadata', { patternMetadata: null }],
    ['compiler metadata', { compilerMetadata: null }],
    ['policy snapshot', { policySnapshot: null }],
    ['reference snapshot', { referenceSnapshot: null }],
    ['tool/skill snapshot', { toolSkillSnapshot: null }],
    ['validation report', { validationReport: null }],
    ['compiled package', { compiledPackage: null }],
    ['execution snapshot', { executionSnapshot: null }],
    ['non-SHA256 fingerprint', { fingerprint: 'not-a-sha256' }],
    ['discriminator/field mismatch', { managedDiscriminator: null }],
    ['invalid status shape', { status: 'published' }],
  ])('rejects malformed managed version insert: %s', async (_case, options) => {
    const db = await database();
    await insertManagedDefinition(db);
    await expect(insertVersionWithOptions(db, options)).rejects.toThrow(
      /check|foreign|managed|published|fingerprint/i,
    );
  });

  it('rejects malformed idempotency rows and exposes every required index explicitly', async () => {
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
    const indexes = await db.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE indexname IN (
         'agent_definitions_managed_owner_name_uq',
         'agent_definitions_id_discriminator_uq',
         'agent_versions_managed_definition_fingerprint_uq',
         'agent_definitions_managed_owner_hidden_idx',
         'agent_versions_managed_owner_hidden_idx',
         'agent_versions_definition_created_cursor_idx'
       )
       ORDER BY indexname`,
    );
    expect(indexes.rows).toHaveLength(6);
    const indexDefs = new Map(
      indexes.rows.map((row) => [row.indexname, row.indexdef]),
    );
    expect(indexDefs.get('agent_definitions_managed_owner_name_uq')).toMatch(
      /\(tenant_id, principal_type, principal_id, normalized_name\).*managed_discriminator.*managed_agent_v1/i,
    );
    expect(
      indexDefs.get('agent_versions_managed_definition_fingerprint_uq'),
    ).toMatch(
      /\(definition_id, fingerprint\).*managed_discriminator.*managed_agent_v1/i,
    );
    expect(indexDefs.get('agent_definitions_id_discriminator_uq')).toMatch(
      /\(id, managed_discriminator\)/i,
    );
    expect(indexDefs.get('agent_definitions_managed_owner_hidden_idx')).toMatch(
      /\(tenant_id, principal_type, principal_id, updated_at DESC, id\).*managed_discriminator.*managed_agent_v1/i,
    );
    expect(indexDefs.get('agent_versions_managed_owner_hidden_idx')).toMatch(
      /\(tenant_id, principal_type, principal_id, updated_at DESC, id\).*managed_discriminator.*managed_agent_v1/i,
    );
    expect(
      indexDefs.get('agent_versions_definition_created_cursor_idx'),
    ).toMatch(/\(definition_id, created_at, id\)/i);
    const idempotencyKey = await db.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint WHERE conname = 'agent_registry_idempotency_pkey'`,
    );
    expect(idempotencyKey.rows).toEqual([
      {
        definition:
          'PRIMARY KEY (operation, tenant_id, principal_type, principal_id, idempotency_key)',
      },
    ]);
  });
});
