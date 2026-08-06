import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createManagedAgentDefinition } from '../../src/domain/agents/managed-agent-definition.js';
import { createManagedAgentDraft } from '../../src/domain/agents/managed-agent-version.js';
import { parseManagedAgentPackage } from '../../src/domain/agents/managed-agent-package.js';
import {
  applyDurableKernelMigrations,
  createPostgresPool,
} from '../../src/infrastructure/postgres/postgres.js';
import { createAgentDefinition } from '../../src/domain/invokables/agent-definition.js';
import { PostgresInvokableRepository } from '../../src/infrastructure/postgres/postgres-invokable-repository.js';
import { PostgresAgentRegistry } from '../../src/infrastructure/postgres/postgres-agent-registry.js';

const definitionId = '00000000-0000-4000-8000-0000000b0001';
const versionId = '00000000-0000-4000-8000-0000000b0101';
const now = '2026-07-23T10:00:00.000Z';
const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (process.env.REAL_POSTGRES_REQUIRED === '1' && !connectionString) {
  throw new Error(
    'REAL_POSTGRES_REQUIRED=1 requires DATABASE_URL or POSTGRES_URL for the real PostgreSQL integration lane',
  );
}
const owner = {
  tenantId: 'tenant_registry',
  principalType: 'service_account',
  principalId: 'principal_registry',
};
const source = `apiVersion: agent-server/v1alpha1
kind: ManagedAgent
metadata:
  name: Registry Agent
spec:
  description: description
  instructions: instructions
  runtime:
    provider: paseo
    modelPolicyRef: free-only
    mode: isolated
  tools: []
  skills: []
  input:
    schema:
      type: object
      additionalProperties: false
      properties: {}
    prompt: hello
  session:
    invocation: fresh_per_invocation
    followUps: queued
    binding: reusable
  memory:
    policy: workspace_snapshot
    proposalLimit: 1
  permissions:
    network: none
    filesystem: none
  completion:
    type: executable
    command: done
`;

async function database(): Promise<PGlite> {
  const db = new PGlite();
  await applyDurableKernelMigrations(db);
  return db;
}

async function downgrade0005DefinitionHardening(db: PGlite): Promise<void> {
  await db.query(
    `DELETE FROM durable_kernel_schema_migrations
     WHERE version = '0005b_managed_agent_registry_hardening'`,
  );
  await db.query(
    'DROP TRIGGER agent_definitions_managed_immutable_before_update ON agent_definitions',
  );
  await db.query(
    'ALTER TABLE agent_definitions DROP CONSTRAINT agent_definitions_managed_shape_check',
  );
  await db.query(`
    ALTER TABLE agent_definitions
      ADD CONSTRAINT agent_definitions_managed_shape_check CHECK ((
        (managed_discriminator IS NULL AND normalized_name IS NULL)
        OR (managed_discriminator = 'managed_agent_v1' AND normalized_name IS NOT NULL AND length(btrim(normalized_name)) > 0)
      ) IS TRUE)
  `);
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
      '0005b_managed_agent_registry_hardening',
      '0006_workspace_session_lane_c',
      '0007_runtime_events_d',
      '0008_managed_memory_e',
      '0009_session_reset_idempotency_hardening',
      '0010_runtime_memory_provenance',
      '0011_runtime_memory_provenance_integrity',
      '0012_session_turn_origin',
      '0013_channel_core',
      '0014_lark_memory_review_surfaces',
      '0015_card_action_ingress_dedup',
      '0016_memory_integrity_receipts',
      '0017_claude_memory_api_skill_mve',
      '0018_managed_environment_runtime_session_mve',
      '0019_team_dag_mve',
      '0020_collaborative_team_mve',
      '0021_web_chat_streaming_mve',
      '0022_learning_proposal_mve',
      '0023_agentic_team_chat_mve',
      '0024_agent_team_messages',
      '0025_agent_team_work_dependencies',
      '0026_agent-teams-v2-cutover',
      '0027_agent-team-roster-limits',
    ]);
  });

  it('applies 0005b to an already-recorded 0005 schema with the old definition hardening', async () => {
    const db = await database();
    await downgrade0005DefinitionHardening(db);
    await expect(applyDurableKernelMigrations(db)).resolves.toBeUndefined();
    const trigger = await db.query(
      `SELECT tgname FROM pg_trigger
       WHERE tgname = 'agent_definitions_managed_immutable_before_update'`,
    );
    const constraint = await db.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
       WHERE conname = 'agent_definitions_managed_shape_check'`,
    );
    expect(trigger.rows).toEqual([
      { tgname: 'agent_definitions_managed_immutable_before_update' },
    ]);
    expect(constraint.rows[0]?.definition).toContain(
      'octet_length(normalized_name) <= 255',
    );
  });

  it('fails safely and rolls back 0005b when an existing managed name is too long', async () => {
    const db = await database();
    await downgrade0005DefinitionHardening(db);
    const longName = 'é'.repeat(128);
    await insertManagedDefinition(
      db,
      '00000000-0000-4000-8000-0000000b00f1',
      'workspace_one',
      longName,
    );
    await expect(applyDurableKernelMigrations(db)).rejects.toThrow(
      /managed agent definition data is invalid/i,
    );
    const migration = await db.query(
      `SELECT version FROM durable_kernel_schema_migrations
       WHERE version = '0005b_managed_agent_registry_hardening'`,
    );
    expect(migration.rows).toEqual([]);
    const constraint = await db.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
       WHERE conname = 'agent_definitions_managed_shape_check'`,
    );
    expect(constraint.rows[0]?.definition).not.toContain(
      'octet_length(normalized_name) <= 255',
    );
  });

  it('recovers 0005b when only its migration registry row is missing', async () => {
    const db = await database();
    await db.query(
      `DELETE FROM durable_kernel_schema_migrations
       WHERE version = '0005b_managed_agent_registry_hardening'`,
    );
    await expect(applyDurableKernelMigrations(db)).resolves.toBeUndefined();
    const rows = await db.query(
      `SELECT version FROM durable_kernel_schema_migrations
       WHERE version = '0005b_managed_agent_registry_hardening'`,
    );
    expect(rows.rows).toEqual([
      { version: '0005b_managed_agent_registry_hardening' },
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

  it('keeps legacy definition repository upserts mutable', async () => {
    const db = await database();
    const repository = new PostgresInvokableRepository(db);
    const definition = createAgentDefinition({
      id: '00000000-0000-4000-8000-0000000b0023',
      tenantId: 'legacy_tenant',
      workspaceId: 'legacy_workspace',
      principalType: 'user',
      principalId: 'legacy_user',
      name: 'Legacy Agent',
      description: 'before',
      now: () => new Date(now),
    });
    await repository.saveAgentDefinition(definition);
    await repository.saveAgentDefinition({
      ...definition,
      name: 'Legacy Agent Updated',
      description: 'after',
      updatedAt: '2026-07-23T10:01:00.000Z',
    });
    await expect(
      repository.findAgentDefinitionById(definition.id),
    ).resolves.toMatchObject({
      name: 'Legacy Agent Updated',
      description: 'after',
    });
  });

  it.each([
    ['display name', "name = 'changed'"],
    ['normalized name', "normalized_name = 'changed'"],
    ['tenant owner', "tenant_id = 'changed'"],
    ['workspace snapshot', "workspace_id = 'changed'"],
    ['principal owner', "principal_id = 'changed'"],
    ['timestamp', "updated_at = '2026-07-23T10:01:00.000Z'"],
    ['discriminator', 'managed_discriminator = NULL'],
  ])('rejects managed definition %s mutation', async (_case, assignment) => {
    const db = await database();
    await insertManagedDefinition(db);
    await expect(
      db.query(`UPDATE agent_definitions SET ${assignment} WHERE id = $1`, [
        definitionId,
      ]),
    ).rejects.toThrow(/immutable|managed|definition/i);
  });

  it('prevents repository upsert from mutating a managed definition', async () => {
    const db = await database();
    await insertManagedDefinition(db);
    const repository = new PostgresInvokableRepository(db);
    await expect(
      repository.saveAgentDefinition({
        id: definitionId,
        tenantId: 'tenant_changed',
        workspaceId: 'workspace_changed',
        principalType: 'service_account',
        principalId: 'principal_changed',
        name: 'Changed by repository',
        description: 'must not persist',
        createdAt: now,
        updatedAt: '2026-07-23T10:01:00.000Z',
      }),
    ).rejects.toThrow(/immutable|managed|definition/i);
  });

  it('rejects legacy-to-managed definition conversion by UPDATE', async () => {
    const db = await database();
    await insertLegacyDefinition(db);
    await expect(
      db.query(
        `UPDATE agent_definitions
         SET managed_discriminator = 'managed_agent_v1', normalized_name = 'legacy-agent'
         WHERE id = $1`,
        [definitionId],
      ),
    ).rejects.toThrow(/insert|managed|definition/i);
  });

  it('enforces the 255 UTF-8 byte normalized-name boundary', async () => {
    const db = await database();
    const exact255 = `${'é'.repeat(127)}a`;
    await insertManagedDefinition(
      db,
      '00000000-0000-4000-8000-0000000b0024',
      'workspace_one',
      exact255,
    );
    await expect(
      insertManagedDefinition(
        db,
        '00000000-0000-4000-8000-0000000b0025',
        'workspace_one',
        'é'.repeat(128),
      ),
    ).rejects.toThrow(/check|255|normalized/i);
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

  it('enforces owner-aware idempotency result definition/version links', async () => {
    const db = await database();
    const secondDefinitionId = '00000000-0000-4000-8000-0000000b0006';
    const secondVersionId = '00000000-0000-4000-8000-0000000b0106';
    await insertManagedDefinition(db);
    await insertManagedVersion(db);
    await insertManagedDefinition(
      db,
      secondDefinitionId,
      'workspace_one',
      'second-agent',
    );
    await insertVersionWithOptions(db, {
      id: secondVersionId,
      definitionId: secondDefinitionId,
      fingerprint:
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    });
    await db.query(
      `INSERT INTO agent_registry_idempotency
       (operation, tenant_id, principal_type, principal_id, idempotency_key, request_fingerprint, definition_id, version_id, created_at, updated_at)
       VALUES ('import', 'tenant_one', 'service_account', 'principal_one', 'valid-result', 'fp-valid', $1, $2, $3, $3)`,
      [definitionId, versionId, now],
    );
    await expect(
      db.query(
        `INSERT INTO agent_registry_idempotency
         (operation, tenant_id, principal_type, principal_id, idempotency_key, request_fingerprint, definition_id, version_id, created_at, updated_at)
         VALUES ('import', 'tenant_two', 'service_account', 'principal_one', 'cross-owner', 'fp-cross', $1, $2, $3, $3)`,
        [definitionId, versionId, now],
      ),
    ).rejects.toThrow(/foreign|owner|key/i);
    await expect(
      db.query(
        `INSERT INTO agent_registry_idempotency
         (operation, tenant_id, principal_type, principal_id, idempotency_key, request_fingerprint, definition_id, version_id, created_at, updated_at)
         VALUES ('import', 'tenant_one', 'service_account', 'principal_two', 'cross-principal', 'fp-cross-principal', $1, $2, $3, $3)`,
        [definitionId, versionId, now],
      ),
    ).rejects.toThrow(/foreign|owner|key/i);
    await expect(
      db.query(
        `INSERT INTO agent_registry_idempotency
         (operation, tenant_id, principal_type, principal_id, idempotency_key, request_fingerprint, definition_id, version_id, created_at, updated_at)
         VALUES ('publish', 'tenant_one', 'service_account', 'principal_one', 'mismatched-pair', 'fp-pair', $1, $2, $3, $3)`,
        [definitionId, secondVersionId, now],
      ),
    ).rejects.toThrow(/foreign|definition|owner/i);
    await expect(
      db.query(
        `INSERT INTO agent_registry_idempotency
         (operation, tenant_id, principal_type, principal_id, idempotency_key, request_fingerprint, definition_id, version_id, created_at, updated_at)
         VALUES ('import', 'tenant_one', 'service_account', 'principal_one', 'half-null', 'fp-half', $1, NULL, $2, $2)`,
        [definitionId, now],
      ),
    ).rejects.toThrow(/check|result/i);
    await expect(
      db.query(
        `INSERT INTO agent_registry_idempotency
         (operation, tenant_id, principal_type, principal_id, idempotency_key, request_fingerprint, definition_id, version_id, created_at, updated_at)
         VALUES ('import', 'tenant_one', 'service_account', 'principal_one', 'other-half-null', 'fp-half-2', NULL, $1, $2, $2)`,
        [versionId, now],
      ),
    ).rejects.toThrow(/check|result/i);
  });

  it('reruns migration 0005 after its registry row is deleted without changing schema objects', async () => {
    const db = await database();
    const before = await db.query<{ conname: string; definition: string }>(
      `SELECT conname, contype, pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conname IN (
         'agent_definitions_managed_shape_check', 'agent_versions_managed_shape_check',
         'agent_versions_managed_definition_fk', 'agent_registry_idempotency_definition_id_fkey',
         'agent_registry_idempotency_version_id_fkey', 'agent_registry_idempotency_pkey',
         'agent_registry_idempotency_operation_check', 'agent_registry_idempotency_key_check',
         'agent_registry_idempotency_fingerprint_check', 'agent_registry_idempotency_owner_check',
         'agent_registry_idempotency_timestamp_check', 'agent_registry_idempotency_result_check',
         'agent_registry_idempotency_owner_definition_fk', 'agent_registry_idempotency_owner_version_fk'
       ) ORDER BY conname`,
    );
    const beforeIndexes = await db.query(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE indexname IN ('agent_definitions_id_discriminator_uq', 'agent_definitions_owner_identity_uq',
         'agent_definitions_managed_owner_name_uq', 'agent_definitions_managed_owner_hidden_idx',
         'agent_versions_managed_definition_fingerprint_uq', 'agent_versions_owner_identity_uq',
         'agent_versions_managed_owner_hidden_idx', 'agent_versions_definition_created_cursor_idx')
       ORDER BY indexname`,
    );
    const beforeTriggers = await db.query(
      `SELECT tgname, pg_get_triggerdef(oid) AS definition
       FROM pg_trigger WHERE tgname IN ('agent_definitions_managed_immutable_before_update', 'agent_versions_managed_immutable_before_update')
       ORDER BY tgname`,
    );
    await db.query(
      `DELETE FROM durable_kernel_schema_migrations WHERE version = '0005_managed_agent_registry_b'`,
    );
    await expect(applyDurableKernelMigrations(db)).resolves.toBeUndefined();
    const after = await db.query(
      `SELECT conname, contype, pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conname IN (
         'agent_definitions_managed_shape_check', 'agent_versions_managed_shape_check',
         'agent_versions_managed_definition_fk', 'agent_registry_idempotency_definition_id_fkey',
         'agent_registry_idempotency_version_id_fkey', 'agent_registry_idempotency_pkey',
         'agent_registry_idempotency_operation_check', 'agent_registry_idempotency_key_check',
         'agent_registry_idempotency_fingerprint_check', 'agent_registry_idempotency_owner_check',
         'agent_registry_idempotency_timestamp_check', 'agent_registry_idempotency_result_check',
         'agent_registry_idempotency_owner_definition_fk', 'agent_registry_idempotency_owner_version_fk'
       ) ORDER BY conname`,
    );
    const afterIndexes = await db.query(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE indexname IN ('agent_definitions_id_discriminator_uq', 'agent_definitions_owner_identity_uq',
         'agent_definitions_managed_owner_name_uq', 'agent_definitions_managed_owner_hidden_idx',
         'agent_versions_managed_definition_fingerprint_uq', 'agent_versions_owner_identity_uq',
         'agent_versions_managed_owner_hidden_idx', 'agent_versions_definition_created_cursor_idx')
       ORDER BY indexname`,
    );
    const afterTriggers = await db.query(
      `SELECT tgname, pg_get_triggerdef(oid) AS definition
       FROM pg_trigger WHERE tgname IN ('agent_definitions_managed_immutable_before_update', 'agent_versions_managed_immutable_before_update')
       ORDER BY tgname`,
    );
    expect(after.rows).toEqual(before.rows);
    expect(afterIndexes.rows).toEqual(beforeIndexes.rows);
    expect(afterTriggers.rows).toEqual(beforeTriggers.rows);
    expect(
      before.rows.find(
        (row) => row.conname === 'agent_definitions_managed_shape_check',
      )?.definition,
    ).toContain('octet_length(normalized_name) <= 255');
    const migrationRows = await db.query(
      `SELECT version FROM durable_kernel_schema_migrations
       WHERE version = '0005_managed_agent_registry_b'`,
    );
    expect(migrationRows.rows).toEqual([
      { version: '0005_managed_agent_registry_b' },
    ]);
    await insertManagedDefinition(db);
    await insertManagedVersion(db);
    await expect(
      insertManagedVersion(db, '00000000-0000-4000-8000-0000000b0110'),
    ).rejects.toThrow(/unique/i);
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

  it('rejects draft publication when the primary-key id changes', async () => {
    const db = await database();
    await insertManagedDefinition(db);
    const draftId = '00000000-0000-4000-8000-0000000b0102';
    const replacementId = '00000000-0000-4000-8000-0000000b0103';
    await insertManagedVersion(db, draftId);
    await expect(
      db.query(
        `UPDATE agent_versions
         SET id = $2, status = 'published', published_at = $3, updated_at = $3
         WHERE id = $1`,
        [draftId, replacementId, '2026-07-23T10:01:00.000Z'],
      ),
    ).rejects.toThrow(/immutable|identity|managed/i);
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
    const expectIndexDefinition = async (
      indexName: string,
      expected: string,
    ): Promise<void> => {
      const result = await db.query<{ indexdef: string }>(
        'SELECT indexdef FROM pg_indexes WHERE indexname = $1',
        [indexName],
      );
      expect(result.rows).toHaveLength(1);
      const normalize = (value: string): string =>
        value
          .replaceAll('"', '')
          .replaceAll("'managed_agent_v1'::text", 'managed_agent_v1')
          .replace(/\s+/g, ' ')
          .trim();
      expect(normalize(result.rows[0]!.indexdef)).toBe(normalize(expected));
    };
    await expectIndexDefinition(
      'agent_definitions_managed_owner_name_uq',
      'CREATE UNIQUE INDEX agent_definitions_managed_owner_name_uq ON public.agent_definitions USING btree (tenant_id, principal_type, principal_id, normalized_name) WHERE (managed_discriminator = managed_agent_v1)',
    );
    await expectIndexDefinition(
      'agent_versions_managed_definition_fingerprint_uq',
      'CREATE UNIQUE INDEX agent_versions_managed_definition_fingerprint_uq ON public.agent_versions USING btree (definition_id, fingerprint) WHERE (managed_discriminator = managed_agent_v1)',
    );
    await expectIndexDefinition(
      'agent_definitions_managed_owner_hidden_idx',
      'CREATE INDEX agent_definitions_managed_owner_hidden_idx ON public.agent_definitions USING btree (tenant_id, principal_type, principal_id, updated_at DESC, id) WHERE (managed_discriminator = managed_agent_v1)',
    );
    await expectIndexDefinition(
      'agent_versions_managed_owner_hidden_idx',
      'CREATE INDEX agent_versions_managed_owner_hidden_idx ON public.agent_versions USING btree (tenant_id, principal_type, principal_id, updated_at DESC, id) WHERE (managed_discriminator = managed_agent_v1)',
    );
    await expectIndexDefinition(
      'agent_versions_definition_created_cursor_idx',
      'CREATE INDEX agent_versions_definition_created_cursor_idx ON public.agent_versions USING btree (definition_id, created_at, id)',
    );
    await expectIndexDefinition(
      'agent_definitions_id_discriminator_uq',
      'CREATE UNIQUE INDEX agent_definitions_id_discriminator_uq ON public.agent_definitions USING btree (id, managed_discriminator)',
    );
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

describe('PostgresAgentRegistry repository contract (PGlite)', () => {
  it('atomically imports, replays, conflicts, hides owners, and traverses a cursor', async () => {
    const db = await database();
    const registry = new PostgresAgentRegistry(db);
    const parsed = parseManagedAgentPackage(source);
    const definition = createManagedAgentDefinition({
      ...owner,
      normalizedName: 'registry-agent',
      displayName: 'Registry Agent',
      id: '00000000-0000-4000-8000-0000000c0001',
      now: () => new Date(now),
    });
    const version = createManagedAgentDraft({
      definition,
      parsed,
      id: '00000000-0000-4000-8000-0000000c0101',
      now: () => new Date(now),
    });
    const command = {
      owner,
      compatibilityWorkspaceId: 'workspace-first',
      idempotencyKey: 'import-1',
      requestFingerprint: 'fp-1',
      normalizedName: 'registry-agent',
      definition,
      version,
    };
    const created = await registry.importAgent(command);
    expect(created.kind).toBe('created');
    expect(Object.isFrozen(created.version.package)).toBe(true);
    expect(
      await registry.findDefinition(
        { ...owner, tenantId: 'other' },
        definition.id,
      ),
    ).toBeNull();
    expect((await registry.importAgent(command)).kind).toBe('replayed');
    await expect(
      registry.importAgent({ ...command, requestFingerprint: 'fp-2' }),
    ).rejects.toThrow('idempotency');
    const page = await registry.listVersionsForOwner(owner, {
      definitionId: definition.id,
      cursor: null,
      limit: 1,
    });
    expect(page?.items).toHaveLength(1);
    expect(page?.nextCursor).toBeNull();
  });

  it('keeps import idempotency timestamps on database time when entity timestamps are stale', async () => {
    const db = await database();
    const registry = new PostgresAgentRegistry(db);
    const parsed = parseManagedAgentPackage(source);
    const stale = () => new Date('2000-01-01T00:00:00.000Z');
    const definition = createManagedAgentDefinition({
      ...owner,
      normalizedName: 'stale-agent',
      displayName: 'Stale Agent',
      id: '00000000-0000-4000-8000-0000000c0002',
      now: stale,
    });
    const version = createManagedAgentDraft({
      definition,
      parsed,
      id: '00000000-0000-4000-8000-0000000c0102',
      now: stale,
    });
    await registry.importAgent({
      owner,
      compatibilityWorkspaceId: 'workspace-stale',
      idempotencyKey: 'stale-import',
      requestFingerprint: 'stale-fingerprint',
      normalizedName: 'stale-agent',
      definition,
      version,
    });
    const row = await db.query<{ created_at: string; updated_at: string }>(
      `SELECT created_at::text, updated_at::text FROM agent_registry_idempotency
        WHERE tenant_id=$1 AND idempotency_key='stale-import'`,
      [owner.tenantId],
    );
    expect(row.rows).toHaveLength(1);
    expect(Date.parse(row.rows[0]!.updated_at)).toBeGreaterThanOrEqual(
      Date.parse(row.rows[0]!.created_at),
    );
  });

  it('publishes stale managed entities on database time without changing content snapshots', async () => {
    const db = await database();
    const registry = new PostgresAgentRegistry(db);
    const parsed = parseManagedAgentPackage(source);
    const stale = () => new Date('2000-01-01T00:00:00.000Z');
    const definition = createManagedAgentDefinition({
      ...owner,
      normalizedName: 'stale-publish-agent',
      displayName: 'Stale Publish Agent',
      id: '00000000-0000-4000-8000-0000000c0003',
      now: stale,
    });
    const version = createManagedAgentDraft({
      definition,
      parsed,
      id: '00000000-0000-4000-8000-0000000c0103',
      now: stale,
    });
    await registry.importAgent({
      owner,
      compatibilityWorkspaceId: 'workspace-stale-publish',
      idempotencyKey: 'stale-publish-import',
      requestFingerprint: 'stale-publish-import-fp',
      normalizedName: 'stale-publish-agent',
      definition,
      version,
    });
    const before = await registry.findVersion(owner, version.id);
    expect(before?.status).toBe('draft');
    const published = await registry.publishAgentVersion({
      owner,
      idempotencyKey: 'stale-publish',
      requestFingerprint: 'stale-publish-fp',
      versionId: version.id,
    });
    expect(published.status).toBe('published');
    expect(Date.parse(published.publishedAt!)).toBeGreaterThan(
      Date.parse(version.createdAt),
    );
    expect(Date.parse(published.updatedAt)).toBeGreaterThanOrEqual(
      Date.parse(published.publishedAt!),
    );
    const after = await registry.findVersion(owner, version.id);
    expect(after).toMatchObject({
      id: version.id,
      createdAt: version.createdAt,
      package: version.package,
      canonicalJson: version.canonicalJson,
      fingerprint: version.fingerprint,
      compiler: version.compiler,
      policySnapshot: version.policySnapshot,
      referenceSnapshot: version.referenceSnapshot,
      validationSnapshot: version.validationSnapshot,
    });
    expect(after?.status).toBe('published');
    expect(after?.publishedAt).toBe(published.publishedAt);
    expect(after?.updatedAt).toBe(published.updatedAt);
    expect(await registry.findDefinition(owner, definition.id)).toEqual(
      definition,
    );
    const idempotency = await db.query<{
      created_at: string;
      updated_at: string;
    }>(
      `SELECT created_at::text, updated_at::text FROM agent_registry_idempotency
        WHERE tenant_id=$1 AND idempotency_key IN ('stale-publish-import','stale-publish')
        ORDER BY idempotency_key`,
      [owner.tenantId],
    );
    expect(idempotency.rows).toHaveLength(2);
    for (const row of idempotency.rows) {
      expect(Date.parse(row.created_at)).toBeGreaterThan(
        Date.parse('2000-01-01T00:00:00.000Z'),
      );
      expect(Date.parse(row.updated_at)).toBeGreaterThanOrEqual(
        Date.parse(row.created_at),
      );
    }
    expect(
      await registry.publishAgentVersion({
        owner,
        idempotencyKey: 'stale-publish',
        requestFingerprint: 'stale-publish-fp',
        versionId: version.id,
      }),
    ).toEqual(published);
  });
});

const describeRealPostgres = connectionString ? describe : describe.skip;
describeRealPostgres(
  'PostgresAgentRegistry repository contract (real PostgreSQL)',
  () => {
    const pool = connectionString
      ? createPostgresPool({ connectionString, maxConnections: 8 })
      : null;

    beforeEach(async () => {
      if (pool) await applyDurableKernelMigrations(pool);
    });

    afterAll(async () => {
      await pool?.end();
    });

    async function reset(tenantId: string): Promise<void> {
      if (!pool) return;
      await pool.query(
        'DELETE FROM agent_registry_idempotency WHERE tenant_id=$1',
        [tenantId],
      );
      await pool.query('DELETE FROM agent_versions WHERE tenant_id=$1', [
        tenantId,
      ]);
      await pool.query('DELETE FROM agent_definitions WHERE tenant_id=$1', [
        tenantId,
      ]);
    }

    function commandFor(
      tenantId: string,
      principalId: string,
      definitionId: string,
      versionId: string,
      key: string,
      fingerprint: string,
      variant = 'Registry Agent',
    ) {
      const realOwner = {
        tenantId,
        principalType: 'service_account',
        principalId,
      };
      const parsed = parseManagedAgentPackage(
        source.replaceAll('Registry Agent', variant),
      );
      const definition = createManagedAgentDefinition({
        ...realOwner,
        normalizedName: 'registry-agent',
        displayName: variant,
        id: definitionId,
        now: () => new Date(now),
      });
      const version = createManagedAgentDraft({
        definition,
        parsed,
        id: versionId,
        now: () => new Date(now),
      });
      return {
        owner: realOwner,
        compatibilityWorkspaceId: 'real-workspace',
        idempotencyKey: key,
        requestFingerprint: fingerprint,
        normalizedName: 'registry-agent',
        definition,
        version,
      };
    }

    it('proves separate leased pg.Pool clients and same-key replay/conflict', async () => {
      expect(pool).not.toBeNull();
      if (!pool) return;
      const clientA = await pool.connect();
      const clientB = await pool.connect();
      try {
        expect(clientA).not.toBe(clientB);
        const server = await clientA.query<{ version: string }>(
          'SELECT version()',
        );
        expect(server.rows[0]?.version).toMatch(/^PostgreSQL /);
      } finally {
        clientA.release();
        clientB.release();
      }
      const tenant = 'real_registry_same_key';
      await reset(tenant);
      const command = commandFor(
        tenant,
        'principal',
        '00000000-0000-4000-8000-0000000d00b1',
        '00000000-0000-4000-8000-0000000d01b1',
        'same-key',
        'real-fp',
      );
      const registry = new PostgresAgentRegistry(pool);
      const [first, replay] = await Promise.all([
        registry.importAgent(command),
        registry.importAgent(command),
      ]);
      expect([first.kind, replay.kind].sort()).toEqual(['created', 'replayed']);
      await expect(
        registry.importAgent({
          ...command,
          requestFingerprint: 'different-fp',
        }),
      ).rejects.toThrow('idempotency');
    });

    it('keeps import idempotency timestamps on database time for stale entities', async () => {
      if (!pool) return;
      const tenant = 'real_registry_stale_time';
      await reset(tenant);
      const registry = new PostgresAgentRegistry(pool);
      const command = commandFor(
        tenant,
        'principal',
        '00000000-0000-4000-8000-0000000d00d1',
        '00000000-0000-4000-8000-0000000d01d1',
        'stale-import',
        'stale-fp',
      );
      const staleDefinition = createManagedAgentDefinition({
        ...command.owner,
        normalizedName: command.normalizedName,
        displayName: command.definition.displayName,
        id: command.definition.id,
        now: () => new Date('2000-01-01T00:00:00.000Z'),
      });
      const staleVersion = createManagedAgentDraft({
        definition: staleDefinition,
        parsed: parseManagedAgentPackage(source),
        id: command.version.id,
        now: () => new Date('2000-01-01T00:00:00.000Z'),
      });
      await registry.importAgent({
        ...command,
        definition: staleDefinition,
        version: staleVersion,
      });
      const row = await pool.query<{ created_at: string; updated_at: string }>(
        `SELECT created_at::text, updated_at::text FROM agent_registry_idempotency
          WHERE tenant_id=$1 AND idempotency_key=$2`,
        [tenant, 'stale-import'],
      );
      expect(row.rows).toHaveLength(1);
      expect(Date.parse(row.rows[0]!.updated_at)).toBeGreaterThanOrEqual(
        Date.parse(row.rows[0]!.created_at),
      );
    });

    it('publishes stale managed entities on database time and keeps immutable snapshots', async () => {
      if (!pool) return;
      const tenant = 'real_registry_stale_publish';
      await reset(tenant);
      const registry = new PostgresAgentRegistry(pool);
      const command = commandFor(
        tenant,
        'principal',
        '00000000-0000-4000-8000-0000000d00e1',
        '00000000-0000-4000-8000-0000000d01e1',
        'stale-publish-import',
        'stale-publish-import-fp',
      );
      const staleDefinition = createManagedAgentDefinition({
        ...command.owner,
        normalizedName: command.normalizedName,
        displayName: command.definition.displayName,
        id: command.definition.id,
        now: () => new Date('2000-01-01T00:00:00.000Z'),
      });
      const staleVersion = createManagedAgentDraft({
        definition: staleDefinition,
        parsed: parseManagedAgentPackage(source),
        id: command.version.id,
        now: () => new Date('2000-01-01T00:00:00.000Z'),
      });
      await registry.importAgent({
        ...command,
        definition: staleDefinition,
        version: staleVersion,
      });
      const before = await pool.query<Record<string, unknown>>(
        `SELECT created_at, status, canonical_package, fingerprint, pattern_metadata,
                compiler_metadata, policy_snapshot, reference_snapshot, tool_skill_snapshot,
                validation_report, compiled_package, execution_snapshot, published_at, updated_at
           FROM agent_versions WHERE id=$1`,
        [staleVersion.id],
      );
      expect(before.rows[0]?.status).toBe('draft');
      const definitionBefore = await registry.findDefinition(
        command.owner,
        staleDefinition.id,
      );
      const published = await registry.publishAgentVersion({
        owner: command.owner,
        idempotencyKey: 'stale-publish',
        requestFingerprint: 'stale-publish-fp',
        versionId: staleVersion.id,
      });
      expect(published.status).toBe('published');
      expect(Date.parse(published.publishedAt!)).toBeGreaterThan(
        Date.parse(staleVersion.createdAt),
      );
      expect(Date.parse(published.updatedAt)).toBeGreaterThanOrEqual(
        Date.parse(published.publishedAt!),
      );
      const after = await pool.query<Record<string, unknown>>(
        `SELECT created_at, status, canonical_package, fingerprint, pattern_metadata,
                compiler_metadata, policy_snapshot, reference_snapshot, tool_skill_snapshot,
                validation_report, compiled_package, execution_snapshot, published_at, updated_at
           FROM agent_versions WHERE id=$1`,
        [staleVersion.id],
      );
      expect(after.rows[0]).toMatchObject({
        created_at: before.rows[0]!.created_at,
        canonical_package: before.rows[0]!.canonical_package,
        fingerprint: before.rows[0]!.fingerprint,
        pattern_metadata: before.rows[0]!.pattern_metadata,
        compiler_metadata: before.rows[0]!.compiler_metadata,
        policy_snapshot: before.rows[0]!.policy_snapshot,
        reference_snapshot: before.rows[0]!.reference_snapshot,
        tool_skill_snapshot: before.rows[0]!.tool_skill_snapshot,
        validation_report: before.rows[0]!.validation_report,
        compiled_package: before.rows[0]!.compiled_package,
        execution_snapshot: before.rows[0]!.execution_snapshot,
        status: 'published',
      });
      expect(definitionBefore).toEqual(
        await registry.findDefinition(command.owner, staleDefinition.id),
      );
      const idempotency = await pool.query<{
        created_at: string;
        updated_at: string;
      }>(
        `SELECT created_at::text, updated_at::text FROM agent_registry_idempotency
          WHERE tenant_id=$1 AND idempotency_key IN ('stale-publish-import','stale-publish')
          ORDER BY idempotency_key`,
        [tenant],
      );
      expect(idempotency.rows).toHaveLength(2);
      for (const row of idempotency.rows) {
        expect(Date.parse(row.created_at)).toBeGreaterThan(
          Date.parse('2000-01-01T00:00:00.000Z'),
        );
        expect(Date.parse(row.updated_at)).toBeGreaterThanOrEqual(
          Date.parse(row.created_at),
        );
      }
      expect(
        await registry.publishAgentVersion({
          owner: command.owner,
          idempotencyKey: 'stale-publish',
          requestFingerprint: 'stale-publish-fp',
          versionId: staleVersion.id,
        }),
      ).toEqual(published);
    });

    it('converges concurrent different-key equal-canonical imports to one definition and version', async () => {
      if (!pool) return;
      const tenant = 'real_registry_equal';
      await reset(tenant);
      const a = commandFor(
        tenant,
        'principal',
        '00000000-0000-4000-8000-0000000d0011',
        '00000000-0000-4000-8000-0000000d0111',
        'key-a',
        'equal-a',
      );
      const b = commandFor(
        tenant,
        'principal',
        '00000000-0000-4000-8000-0000000d0012',
        '00000000-0000-4000-8000-0000000d0112',
        'key-b',
        'equal-b',
      );
      const registry = new PostgresAgentRegistry(pool);
      const results = await Promise.all([
        registry.importAgent(a),
        registry.importAgent(b),
      ]);
      expect(new Set(results.map((result) => result.definition.id)).size).toBe(
        1,
      );
      expect(new Set(results.map((result) => result.version.id)).size).toBe(1);
      const counts = await pool.query<{
        definitions: string;
        versions: string;
      }>(
        `SELECT (SELECT count(*) FROM agent_definitions WHERE tenant_id=$1)::text AS definitions,
                (SELECT count(*) FROM agent_versions WHERE tenant_id=$1)::text AS versions`,
        [tenant],
      );
      expect(counts.rows[0]).toEqual({ definitions: '1', versions: '1' });
    });

    it('creates a changed-fingerprint draft under the same owner/name definition', async () => {
      if (!pool) return;
      const tenant = 'real_registry_changed';
      await reset(tenant);
      const registry = new PostgresAgentRegistry(pool);
      const first = await registry.importAgent(
        commandFor(
          tenant,
          'principal',
          '00000000-0000-4000-8000-0000000d0021',
          '00000000-0000-4000-8000-0000000d0121',
          'key-a',
          'changed-a',
        ),
      );
      const second = await registry.importAgent(
        commandFor(
          tenant,
          'principal',
          '00000000-0000-4000-8000-0000000d0022',
          '00000000-0000-4000-8000-0000000d0122',
          'key-b',
          'changed-b',
          'Registry Agent Revised',
        ),
      );
      expect(second.definition.id).toBe(first.definition.id);
      expect(second.version.id).not.toBe(first.version.id);
      expect(second.version.status).toBe('draft');
    });

    it('converges concurrent owner/name and definition/fingerprint races', async () => {
      if (!pool) return;
      const tenant = 'real_registry_race';
      await reset(tenant);
      const registry = new PostgresAgentRegistry(pool);
      const commands = Array.from({ length: 4 }, (_, index) =>
        commandFor(
          tenant,
          'principal',
          `00000000-0000-4000-8000-0000000d00${31 + index}`,
          `00000000-0000-4000-8000-0000000d01${31 + index}`,
          `race-${index}`,
          `race-fp-${index}`,
        ),
      );
      const results = await Promise.all(
        commands.map((command) => registry.importAgent(command)),
      );
      expect(new Set(results.map((result) => result.definition.id)).size).toBe(
        1,
      );
      expect(new Set(results.map((result) => result.version.id)).size).toBe(1);
    });

    it('publishes with replay/conflict semantics and one concurrent immutable transition', async () => {
      if (!pool) return;
      const tenant = 'real_registry_publish';
      await reset(tenant);
      const registry = new PostgresAgentRegistry(pool);
      const imported = await registry.importAgent(
        commandFor(
          tenant,
          'principal',
          '00000000-0000-4000-8000-0000000d0051',
          '00000000-0000-4000-8000-0000000d0151',
          'import',
          'publish-import',
        ),
      );
      const publish = {
        owner: imported.version,
        idempotencyKey: 'publish-a',
        requestFingerprint: 'publish-fp',
        versionId: imported.version.id,
      };
      const ownerForPublish = {
        tenantId: imported.version.tenantId,
        principalType: imported.version.principalType,
        principalId: imported.version.principalId,
      };
      const publishCommand = { ...publish, owner: ownerForPublish };
      const replay = await registry.publishAgentVersion(publishCommand);
      expect(replay.status).toBe('published');
      expect(
        (await registry.publishAgentVersion(publishCommand)).publishedAt,
      ).toBe(replay.publishedAt);
      await expect(
        registry.publishAgentVersion({
          ...publishCommand,
          versionId: '00000000-0000-4000-8000-0000000d0152',
          requestFingerprint: 'other',
        }),
      ).rejects.toThrow('idempotency');
      const concurrent = await Promise.all([
        registry.publishAgentVersion({
          ...publishCommand,
          idempotencyKey: 'publish-b',
          requestFingerprint: 'publish-b-fp',
        }),
        registry.publishAgentVersion({
          ...publishCommand,
          idempotencyKey: 'publish-c',
          requestFingerprint: 'publish-c-fp',
        }),
      ]);
      expect(new Set(concurrent.map((result) => result.publishedAt)).size).toBe(
        1,
      );
      const rows = await pool.query<{ count: string; status: string }>(
        'SELECT count(*)::text AS count, min(status) AS status FROM agent_versions WHERE tenant_id=$1',
        [tenant],
      );
      expect(rows.rows[0]).toEqual({ count: '1', status: 'published' });
    });

    it('races two distinct publication claims while the managed version is still draft', async () => {
      if (!pool) return;
      const tenant = 'real_registry_publish_race';
      await reset(tenant);
      const registry = new PostgresAgentRegistry(pool);
      const imported = await registry.importAgent(
        commandFor(
          tenant,
          'principal',
          '00000000-0000-4000-8000-0000000d00c1',
          '00000000-0000-4000-8000-0000000d01c1',
          'race-import',
          'race-import-fp',
        ),
      );
      expect(imported.version.status).toBe('draft');

      const ownerForPublish = {
        tenantId: imported.version.tenantId,
        principalType: imported.version.principalType,
        principalId: imported.version.principalId,
      };
      const publishA = {
        owner: ownerForPublish,
        idempotencyKey: 'race-publish-a',
        requestFingerprint: 'race-publish-a-fp',
        versionId: imported.version.id,
      };
      const publishB = {
        owner: ownerForPublish,
        idempotencyKey: 'race-publish-b',
        requestFingerprint: 'race-publish-b-fp',
        versionId: imported.version.id,
      };
      const [publishedA, publishedB] = await Promise.all([
        registry.publishAgentVersion(publishA),
        registry.publishAgentVersion(publishB),
      ]);

      expect(publishedA.id).toBe(imported.version.id);
      expect(publishedB.id).toBe(imported.version.id);
      expect(publishedA).toEqual(publishedB);
      expect(publishedA.status).toBe('published');
      expect(publishedA.publishedAt).toBe(publishedA.updatedAt);
      expect(publishedA.package).toEqual(imported.version.package);
      expect(publishedA.canonicalJson).toBe(imported.version.canonicalJson);
      expect(publishedA.fingerprint).toBe(imported.version.fingerprint);

      const durable = await pool.query<{
        count: string;
        status: string;
        published_at: string;
        instructions: string;
        fingerprint: string;
      }>(
        `SELECT count(*)::text AS count, min(status) AS status, min(published_at)::text AS published_at,
                min(instructions) AS instructions, min(fingerprint) AS fingerprint
           FROM agent_versions WHERE tenant_id=$1 AND id=$2`,
        [tenant, imported.version.id],
      );
      expect(durable.rows[0]).toMatchObject({
        count: '1',
        status: 'published',
        instructions: imported.version.package.spec.instructions,
        fingerprint: imported.version.fingerprint.replace('sha256:', ''),
      });
      expect(new Date(durable.rows[0]!.published_at).toISOString()).toBe(
        publishedA.publishedAt,
      );
      const claims = await pool.query<{
        idempotency_key: string;
        definition_id: string;
        version_id: string;
      }>(
        `SELECT idempotency_key, definition_id, version_id
           FROM agent_registry_idempotency
          WHERE tenant_id=$1 AND operation='publish' ORDER BY idempotency_key`,
        [tenant],
      );
      expect(claims.rows).toEqual([
        {
          idempotency_key: publishA.idempotencyKey,
          definition_id: imported.definition.id,
          version_id: imported.version.id,
        },
        {
          idempotency_key: publishB.idempotencyKey,
          definition_id: imported.definition.id,
          version_id: imported.version.id,
        },
      ]);
    });

    it('hides definitions, versions, lists, and publication from another principal', async () => {
      if (!pool) return;
      const tenant = 'real_registry_hidden';
      await reset(tenant);
      const registry = new PostgresAgentRegistry(pool);
      const imported = await registry.importAgent(
        commandFor(
          tenant,
          'owner',
          '00000000-0000-4000-8000-0000000d0061',
          '00000000-0000-4000-8000-0000000d0161',
          'hidden',
          'hidden-fp',
        ),
      );
      const hidden = {
        tenantId: tenant,
        principalType: 'service_account',
        principalId: 'other',
      };
      expect(
        await registry.findDefinition(hidden, imported.definition.id),
      ).toBeNull();
      expect(
        await registry.findVersion(hidden, imported.version.id),
      ).toBeNull();
      expect(
        await registry.listVersionsForOwner(hidden, {
          definitionId: imported.definition.id,
          cursor: null,
          limit: 2,
        }),
      ).toBeNull();
      await expect(
        registry.publishAgentVersion({
          owner: hidden,
          idempotencyKey: 'hidden-publish',
          requestFingerprint: 'hidden',
          versionId: imported.version.id,
        }),
      ).rejects.toThrow('not found');
    });

    it('rejects direct SQL mutation of published managed content', async () => {
      if (!pool) return;
      const tenant = 'real_registry_immutable';
      await reset(tenant);
      const registry = new PostgresAgentRegistry(pool);
      const imported = await registry.importAgent(
        commandFor(
          tenant,
          'principal',
          '00000000-0000-4000-8000-0000000d00a1',
          '00000000-0000-4000-8000-0000000d0171',
          'immutable',
          'immutable-fp',
        ),
      );
      await registry.publishAgentVersion({
        owner: imported.version,
        idempotencyKey: 'publish',
        requestFingerprint: 'immutable-publish',
        versionId: imported.version.id,
      });
      await expect(
        pool.query(
          'UPDATE agent_versions SET canonical_package=$2::jsonb WHERE id=$1',
          [imported.version.id, '{"mutated":true}'],
        ),
      ).rejects.toThrow(/immutable/i);
      await expect(
        pool.query('UPDATE agent_versions SET fingerprint=$2 WHERE id=$1', [
          imported.version.id,
          'b'.repeat(64),
        ]),
      ).rejects.toThrow(/immutable/i);
    });

    it('traverses equal-timestamp pages strictly in (created_at,id) order', async () => {
      if (!pool) return;
      const tenant = 'real_registry_cursor';
      await reset(tenant);
      const registry = new PostgresAgentRegistry(pool);
      const ids = Array.from(
        { length: 5 },
        (_, index) =>
          `00000000-0000-4000-8000-0000000d0${String(81 + index).padStart(3, '0')}`,
      );
      let definitionId = '';
      for (const [index, id] of ids.entries()) {
        const result = await registry.importAgent(
          commandFor(
            tenant,
            'principal',
            `00000000-0000-4000-8000-0000000d0${String(71).padStart(3, '0')}`,
            id,
            `cursor-${index}`,
            `cursor-fp-${index}`,
            `Registry Agent ${index}`,
          ),
        );
        definitionId = result.definition.id;
      }
      const seen: string[] = [];
      let cursor: string | null = null;
      for (;;) {
        const page = await registry.listVersionsForOwner(
          {
            tenantId: tenant,
            principalType: 'service_account',
            principalId: 'principal',
          },
          { definitionId, cursor, limit: 2 },
        );
        expect(page).not.toBeNull();
        if (!page) break;
        seen.push(...page.items.map((item) => item.id));
        if (!page.nextCursor) {
          expect(page.items.length).toBeLessThanOrEqual(2);
          break;
        }
        cursor = page.nextCursor;
      }
      expect(seen).toEqual([...seen].sort((a, b) => a.localeCompare(b)));
      expect(new Set(seen).size).toBe(5);
      expect(seen).toEqual(ids);
    });

    it('round-trips immutable package and all managed snapshots', async () => {
      if (!pool) return;
      const tenant = 'real_registry_snapshots';
      await reset(tenant);
      const registry = new PostgresAgentRegistry(pool);
      const command = commandFor(
        tenant,
        'principal',
        '00000000-0000-4000-8000-0000000d0091',
        '00000000-0000-4000-8000-0000000d0191',
        'snapshots',
        'snapshots-fp',
      );
      const imported = await registry.importAgent(command);
      const reloaded = await registry.findVersion(
        command.owner,
        imported.version.id,
      );
      expect(reloaded).not.toBeNull();
      expect(reloaded).toMatchObject({
        package: command.version.package,
        canonicalJson: command.version.canonicalJson,
        fingerprint: command.version.fingerprint,
        compiler: command.version.compiler,
        policySnapshot: command.version.policySnapshot,
        referenceSnapshot: command.version.referenceSnapshot,
        validationSnapshot: command.version.validationSnapshot,
      });
      expect(Object.isFrozen(reloaded?.package)).toBe(true);
    });
  },
);
