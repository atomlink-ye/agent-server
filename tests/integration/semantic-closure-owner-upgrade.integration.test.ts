import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';

import { fingerprintWorkDefinitionSource } from '../../src/domain/work/work-definition-source.js';

const migrations = join(
  fileURLToPath(
    new URL('../../src/infrastructure/postgres/migrations/', import.meta.url),
  ),
);
let db: PGlite | undefined;

const workspaceA = '11000000-0000-4000-8000-000000000001';
const workspaceB = '11000000-0000-4000-8000-000000000002';
const agentId = '21000000-0000-4000-8000-000000000001';
const workerDefinitionA = '41000000-0000-4000-8000-000000000001';
const workerVersionA = '42000000-0000-4000-8000-000000000001';
const workerDefinitionB = '41000000-0000-4000-8000-000000000002';
const workerVersionB = '42000000-0000-4000-8000-000000000002';
const definitionB = '31000000-0000-4000-8000-000000000002';
const definitionVersionB = '32000000-0000-4000-8000-000000000002';

const workSource = {
  kind: 'single_worker' as const,
  workerVersionId: workerVersionB,
  environmentVersionId: '71000000-0000-4000-8000-000000000002',
  memoryVersionIds: [] as readonly string[],
};

const closureSql = () =>
  readFileSync(join(migrations, '0061_semantic_closure.sql'), 'utf8');

async function migrateThrough0060(database: PGlite): Promise<void> {
  const files = readdirSync(migrations)
    .filter(
      (name) => name.endsWith('.sql') && name < '0061_semantic_closure.sql',
    )
    .sort();
  for (const file of files)
    await database.exec(readFileSync(join(migrations, file), 'utf8'));
}

async function seedWorkspaces(database: PGlite): Promise<void> {
  await database.exec(`
    INSERT INTO workspaces
      (id,tenant_id,principal_type,principal_id,name,created_at,updated_at)
    VALUES
      ('${workspaceA}','tenant-a','service_account','service-a','A',now(),now()),
      ('${workspaceB}','tenant-a','service_account','service-a','B',now(),now());
  `);
}

afterEach(async () => {
  await db?.close();
  db = undefined;
});

describe('0061 semantic owner upgrade', () => {
  it('preserves a Coworker Work Catalog binding across authorized workspaces', async () => {
    db = new PGlite();
    await migrateThrough0060(db);
    await seedWorkspaces(db);

    const source = JSON.stringify(workSource);
    const fingerprint = fingerprintWorkDefinitionSource(workSource);
    await db.exec(`
      INSERT INTO agent_definitions
        (id,tenant_id,workspace_id,principal_type,principal_id,name,managed_discriminator,normalized_name,created_at,updated_at)
      VALUES
        ('${agentId}','tenant-a','${workspaceA}','service_account','service-a','Cross Workspace Coworker','managed_agent_v1','cross-workspace-coworker',now(),now());

      INSERT INTO work_definition_source_definitions
        (id,tenant_id,workspace_id,principal_type,principal_id,name,description,created_at)
      VALUES
        ('${definitionB}','tenant-a','${workspaceB}','service_account','service-a','workspace-b-work',NULL,now());

      INSERT INTO work_definition_source_versions
        (id,definition_id,tenant_id,workspace_id,principal_type,principal_id,status,source,fingerprint,created_at,published_at)
      VALUES
        ('${definitionVersionB}','${definitionB}','tenant-a','${workspaceB}','service_account','service-a','published','${source}'::jsonb,'${fingerprint}',now(),now());

      INSERT INTO agent_work_bindings
        (tenant_id,workspace_id,agent_definition_id,work_definition_id,active_work_definition_version_id,status,created_at,updated_at)
      VALUES
        ('tenant-a','${workspaceB}','${agentId}','${definitionB}','${definitionVersionB}','enabled',now(),now());
    `);

    await db.exec(closureSql());

    const bindings = await db.query<{
      workspace_id: string;
      principal_id: string;
      agent_definition_id: string;
      work_definition_id: string;
    }>(
      `SELECT workspace_id::text,principal_id,agent_definition_id,work_definition_id
         FROM agent_work_bindings`,
    );
    expect(bindings.rows).toEqual([
      {
        workspace_id: workspaceB,
        principal_id: 'service-a',
        agent_definition_id: agentId,
        work_definition_id: definitionB,
      },
    ]);
  });

  it('backfills completed Worker claims and allows the same idempotency key in another workspace', async () => {
    db = new PGlite();
    await migrateThrough0060(db);
    await seedWorkspaces(db);

    await db.exec(`
      INSERT INTO worker_definitions
        (id,tenant_id,workspace_id,principal_type,principal_id,name,normalized_name,description,created_at,updated_at)
      VALUES
        ('${workerDefinitionA}','tenant-a','${workspaceA}','service_account','service-a','A worker','same-name',NULL,now(),now());

      INSERT INTO worker_versions
        (id,definition_id,tenant_id,workspace_id,principal_type,principal_id,status,name,description,instructions,canonical_package,fingerprint,compiler_metadata,created_at,updated_at,published_at)
      VALUES
        ('${workerVersionA}','${workerDefinitionA}','tenant-a','${workspaceA}','service_account','service-a','published','A worker',NULL,'work','{}','${'a'.repeat(64)}','{}',now(),now(),now());

      INSERT INTO worker_registry_idempotency
        (operation,tenant_id,principal_type,principal_id,idempotency_key,request_fingerprint,definition_id,version_id,created_at,updated_at)
      VALUES
        ('import','tenant-a','service_account','service-a','shared-key','request-a','${workerDefinitionA}','${workerVersionA}',now(),now());
    `);

    await db.exec(closureSql());

    const upgraded = await db.query<{ workspace_id: string }>(
      `SELECT workspace_id
         FROM worker_registry_idempotency
        WHERE idempotency_key='shared-key'`,
    );
    expect(upgraded.rows[0]?.workspace_id).toBe(workspaceA);

    await db.exec(`
      INSERT INTO worker_definitions
        (id,tenant_id,workspace_id,principal_type,principal_id,name,normalized_name,description,created_at,updated_at)
      VALUES
        ('${workerDefinitionB}','tenant-a','${workspaceB}','service_account','service-a','B worker','same-name',NULL,now(),now());

      INSERT INTO worker_versions
        (id,definition_id,tenant_id,workspace_id,principal_type,principal_id,status,name,description,instructions,canonical_package,fingerprint,compiler_metadata,created_at,updated_at,published_at)
      VALUES
        ('${workerVersionB}','${workerDefinitionB}','tenant-a','${workspaceB}','service_account','service-a','published','B worker',NULL,'work','{}','${'b'.repeat(64)}','{}',now(),now(),now());

      INSERT INTO worker_registry_idempotency
        (operation,tenant_id,workspace_id,principal_type,principal_id,idempotency_key,request_fingerprint,definition_id,version_id,created_at,updated_at)
      VALUES
        ('import','tenant-a','${workspaceB}','service_account','service-a','shared-key','request-b','${workerDefinitionB}','${workerVersionB}',now(),now());
    `);

    const claims = await db.query<{ workspace_id: string }>(
      `SELECT workspace_id
         FROM worker_registry_idempotency
        WHERE idempotency_key='shared-key'
        ORDER BY workspace_id`,
    );
    expect(claims.rows.map((row) => row.workspace_id)).toEqual([
      workspaceA,
      workspaceB,
    ]);
  });

  it('fails closed instead of deleting an ambiguous incomplete legacy Worker claim', async () => {
    db = new PGlite();
    await migrateThrough0060(db);
    await seedWorkspaces(db);

    await db.exec(`
      INSERT INTO worker_registry_idempotency
        (operation,tenant_id,principal_type,principal_id,idempotency_key,request_fingerprint,definition_id,version_id,created_at,updated_at)
      VALUES
        ('import','tenant-a','service_account','service-a','ambiguous-key','ambiguous-request',NULL,NULL,now(),now());
    `);

    await expect(db.exec(closureSql())).rejects.toThrow(
      'Cannot infer workspace for legacy Worker idempotency claim',
    );
    await db.exec('ROLLBACK');

    const claims = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM worker_registry_idempotency
        WHERE idempotency_key='ambiguous-key'`,
    );
    expect(claims.rows[0]?.count).toBe(1);
  });
});
