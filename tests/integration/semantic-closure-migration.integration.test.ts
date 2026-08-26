import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';

const migrations = join(
  fileURLToPath(
    new URL('../../src/infrastructure/postgres/migrations/', import.meta.url),
  ),
);
let db: PGlite | undefined;

const workspaceA = '10000000-0000-4000-8000-00000000a001';
const workspaceB = '10000000-0000-4000-8000-00000000a002';
const agentA = '20000000-0000-4000-8000-00000000a001';
const agentB = '20000000-0000-4000-8000-00000000a002';
const definitionA = '30000000-0000-4000-8000-00000000a001';
const definitionB = '30000000-0000-4000-8000-00000000a002';
const definitionVersionA = '31000000-0000-4000-8000-00000000a001';
const definitionVersionB = '31000000-0000-4000-8000-00000000a002';
const workerDefinition = '40000000-0000-4000-8000-00000000a001';
const workerVersion = '41000000-0000-4000-8000-00000000a001';
const workA = '50000000-0000-4000-8000-00000000a001';
const healthyConversation = '60000000-0000-4000-8000-00000000a001';
const orphanConversation = '60000000-0000-4000-8000-00000000a002';

const sourceA = JSON.stringify({
  kind: 'single_worker',
  workerVersionId: workerVersion,
  environmentVersionId: '70000000-0000-4000-8000-00000000a001',
  memoryVersionIds: [],
});

const hashA = `sha256:${'a'.repeat(64)}`;
const hashB = `sha256:${'b'.repeat(64)}`;

afterEach(async () => {
  await db?.close();
  db = undefined;
});

async function migrateBefore0061(database: PGlite): Promise<void> {
  for (const file of readdirSync(migrations)
    .filter((name) => name.endsWith('.sql') && name < '0061_semantic_closure.sql')
    .sort())
    await database.exec(readFileSync(join(migrations, file), 'utf8'));
}

describe('0061 semantic closure migration', () => {
  it('repairs owner keys, removes orphan wakes, and rejects hybrid catalog lineage', async () => {
    db = new PGlite();
    await migrateBefore0061(db);

    await db.exec(`
      INSERT INTO workspaces
        (id,tenant_id,principal_type,principal_id,name,created_at,updated_at)
      VALUES
        ('${workspaceA}','tenant-a','service_account','service-a','A',now(),now()),
        ('${workspaceB}','tenant-a','service_account','service-a','B',now(),now());

      INSERT INTO agent_definitions
        (id,tenant_id,workspace_id,principal_type,principal_id,name,managed_discriminator,normalized_name,created_at,updated_at)
      VALUES
        ('${agentA}','tenant-a','${workspaceA}','service_account','service-a','Coworker A','managed_agent_v1','coworker-a',now(),now()),
        ('${agentB}','tenant-a','${workspaceA}','service_account','service-a','Coworker B','managed_agent_v1','coworker-b',now(),now());

      INSERT INTO worker_definitions
        (id,tenant_id,workspace_id,principal_type,principal_id,name,normalized_name,description,created_at,updated_at)
      VALUES
        ('${workerDefinition}','tenant-a','${workspaceA}','service_account','service-a','Shared name','shared-name',NULL,now(),now());

      INSERT INTO worker_versions
        (id,definition_id,tenant_id,workspace_id,principal_type,principal_id,status,name,description,instructions,canonical_package,fingerprint,compiler_metadata,created_at,updated_at,published_at)
      VALUES
        ('${workerVersion}','${workerDefinition}','tenant-a','${workspaceA}','service_account','service-a','published','Shared name',NULL,'Do work','{"apiVersion":"agent-server/v1alpha1","kind":"Worker","metadata":{"name":"shared-name"},"spec":{}}','${'c'.repeat(64)}','{}',now(),now(),now());

      INSERT INTO worker_registry_idempotency
        (operation,tenant_id,principal_type,principal_id,idempotency_key,request_fingerprint,definition_id,version_id,created_at,updated_at)
      VALUES
        ('import','tenant-a','service_account','service-a','same-key','request-a','${workerDefinition}','${workerVersion}',now(),now());

      INSERT INTO work_definition_source_definitions
        (id,tenant_id,workspace_id,principal_type,principal_id,name,description,created_at)
      VALUES
        ('${definitionA}','tenant-a','${workspaceA}','service_account','service-a','definition-a',NULL,now()),
        ('${definitionB}','tenant-a','${workspaceA}','service_account','service-a','definition-b',NULL,now());

      INSERT INTO work_definition_source_versions
        (id,definition_id,tenant_id,workspace_id,principal_type,principal_id,status,source,fingerprint,created_at,published_at)
      VALUES
        ('${definitionVersionA}','${definitionA}','tenant-a','${workspaceA}','service_account','service-a','published','${sourceA}'::jsonb,'${hashA}',now(),now()),
        ('${definitionVersionB}','${definitionB}','tenant-a','${workspaceA}','service_account','service-a','published','${sourceA}'::jsonb,'${hashB}',now(),now());

      INSERT INTO agent_work_bindings
        (tenant_id,workspace_id,agent_definition_id,work_definition_id,active_work_definition_version_id,status,created_at,updated_at)
      VALUES
        ('tenant-a','${workspaceA}','${agentA}','${definitionA}','${definitionVersionA}','enabled',now(),now()),
        ('tenant-a','${workspaceA}','${agentB}','${definitionA}','${definitionVersionB}','enabled',now(),now());

      INSERT INTO works
        (id,tenant_id,workspace_id,definition_id,current_definition_version_id,title,origin,created_at,updated_at)
      VALUES
        ('${workA}','tenant-a','${workspaceA}','${definitionA}','${definitionVersionA}','Healthy work','created',now(),now());

      INSERT INTO conversations
        (id,tenant_id,kind,direct_pair_key,next_sequence,created_at,updated_at)
      VALUES
        ('${healthyConversation}','tenant-a','direct','direct:healthy',1,now(),now());

      INSERT INTO conversation_work_links
        (tenant_id,workspace_id,work_id,conversation_id,created_at)
      VALUES
        ('tenant-a','${workspaceA}','${workA}','${healthyConversation}',now());

      INSERT INTO work_chat_wake_outbox
        (tenant_id,workspace_id,work_id,transition_no,conversation_id,work_ref,title,product_state,result_capture_status,observed_at,created_at)
      VALUES
        ('tenant-a','${workspaceA}','${workA}',1,'${healthyConversation}','${workA}','Healthy work','complete','present',now(),now()),
        ('tenant-a','${workspaceA}','50000000-0000-4000-8000-00000000a099',1,'${orphanConversation}','orphan','Orphan work','complete','not_present',now(),now());
    `);

    const migration = readFileSync(
      join(migrations, '0061_semantic_closure.sql'),
      'utf8',
    );
    await db.exec(migration);

    const idempotency = await db.query<{
      workspace_id: string;
    }>(
      `SELECT workspace_id FROM worker_registry_idempotency WHERE idempotency_key='same-key'`,
    );
    expect(idempotency.rows[0]?.workspace_id).toBe(workspaceA);

    await expect(
      db.exec(`
        INSERT INTO worker_definitions
          (id,tenant_id,workspace_id,principal_type,principal_id,name,normalized_name,description,created_at,updated_at)
        VALUES
          ('40000000-0000-4000-8000-00000000a002','tenant-a','${workspaceB}','service_account','service-a','Shared name','shared-name',NULL,now(),now());
      `),
    ).resolves.toBeUndefined();

    const bindings = await db.query<{
      agent_definition_id: string;
      principal_id: string;
    }>(
      `SELECT agent_definition_id,principal_id FROM agent_work_bindings ORDER BY agent_definition_id`,
    );
    expect(bindings.rows).toEqual([
      { agent_definition_id: agentA, principal_id: 'service-a' },
    ]);

    await expect(
      db.exec(`
        INSERT INTO agent_work_bindings
          (tenant_id,workspace_id,principal_type,principal_id,agent_definition_id,work_definition_id,active_work_definition_version_id,status,created_at,updated_at)
        VALUES
          ('tenant-a','${workspaceA}','service_account','service-a','${agentB}','${definitionA}','${definitionVersionB}','enabled',now(),now());
      `),
    ).rejects.toThrow();

    const wakes = await db.query<{ conversation_id: string }>(
      `SELECT conversation_id FROM work_chat_wake_outbox ORDER BY id`,
    );
    expect(wakes.rows).toEqual([{ conversation_id: healthyConversation }]);
  });

  it('is safe when there is no legacy state to repair', async () => {
    db = new PGlite();
    await migrateBefore0061(db);
    const migration = readFileSync(
      join(migrations, '0061_semantic_closure.sql'),
      'utf8',
    );
    await expect(db.exec(migration)).resolves.toBeUndefined();
  });
});
