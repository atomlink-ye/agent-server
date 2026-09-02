import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

import { PostgresWorkDefinitionSourceRepository } from '../../src/infrastructure/postgres/postgres-work-definition-source-repository.js';
import { fingerprintWorkDefinitionSource } from '../../src/domain/work/work-definition-source.js';
import {
  applyDurableKernelMigrations,
  createPostgresPool,
} from '../../src/infrastructure/postgres/postgres.js';

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!connectionString)
  throw new Error(
    'real PostgreSQL integration requires DATABASE_URL or POSTGRES_URL',
  );

const tenantId = 'agent-work-bindings-real-pg-tenant';
const workspaceId = randomUUID();
const principalType = 'service_account';
const principalId = 'agent-work-bindings-real-pg';
const at = '2026-09-02T00:00:00.000Z';

describe('listAgentWorkBindings on real PostgreSQL', () => {
  let pool: Pool;
  const definitionId = randomUUID();
  const versionId = randomUUID();
  const agentDefinitionId = randomUUID();

  beforeAll(async () => {
    pool = createPostgresPool({
      connectionString: connectionString!,
      maxConnections: 2,
    });
    await applyDurableKernelMigrations(pool);
    await pool.query(
      `INSERT INTO workspaces
       (id,tenant_id,principal_type,principal_id,name,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$6)
       ON CONFLICT (id) DO UPDATE SET
         tenant_id=EXCLUDED.tenant_id,
         principal_type=EXCLUDED.principal_type,
         principal_id=EXCLUDED.principal_id,
         updated_at=EXCLUDED.updated_at`,
      [workspaceId, tenantId, principalType, principalId, 'Bindings PG', at],
    );
    await pool.query(
      `INSERT INTO agent_definitions
       (id,tenant_id,workspace_id,principal_type,principal_id,name,managed_discriminator,normalized_name,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,'managed_agent_v1',$6,$7,$7)`,
      [
        agentDefinitionId,
        tenantId,
        workspaceId,
        principalType,
        principalId,
        'qflow-fix1-2-agent',
        at,
      ],
    );
    await pool.query(
      `INSERT INTO work_definition_source_definitions
       (id,tenant_id,workspace_id,principal_type,principal_id,name,description,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        definitionId,
        tenantId,
        workspaceId,
        principalType,
        principalId,
        'qflow-fix-timing',
        null,
        at,
      ],
    );
    const source = {
      kind: 'single_worker',
      workerVersionId: randomUUID(),
      environmentVersionId: randomUUID(),
      memoryVersionIds: [],
      inputSchema: {
        type: 'object',
        properties: { note: { type: 'string' } },
        required: [],
        additional_properties: false,
      },
    };
    await pool.query(
      `INSERT INTO work_definition_source_versions
       (id,definition_id,tenant_id,workspace_id,principal_type,principal_id,status,source,fingerprint,author_source,author_fingerprint,created_at,published_at)
       VALUES($1,$2,$3,$4,$5,$6,'published',$7,$8,$7,$8,$9,$9)`,
      [
        versionId,
        definitionId,
        tenantId,
        workspaceId,
        principalType,
        principalId,
        JSON.stringify(source),
        fingerprintWorkDefinitionSource(source as never),
        at,
      ],
    );
    await pool.query(
      `INSERT INTO agent_work_bindings
       (tenant_id,workspace_id,principal_type,principal_id,agent_definition_id,work_definition_id,active_work_definition_version_id,status,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,'enabled',$8,$8)`,
      [
        tenantId,
        workspaceId,
        principalType,
        principalId,
        agentDefinitionId,
        definitionId,
        versionId,
        at,
      ],
    );
  });

  afterAll(async () => {
    // Published Work Definition source rows are immutable by design (a
    // real system invariant, not a test artifact) — the fixture rows are
    // left in place; only the binding itself (mutable) is cleaned up.
    await pool.query(
      'DELETE FROM agent_work_bindings WHERE agent_definition_id = $1',
      [agentDefinitionId],
    );
    await pool.query('DELETE FROM agent_definitions WHERE id = $1', [
      agentDefinitionId,
    ]);
    await pool?.end();
  });

  it('returns the definition id and version id as distinct values, not the version id twice', async () => {
    const sources = new PostgresWorkDefinitionSourceRepository(pool);
    const bindings = await sources.listAgentWorkBindings({
      tenantId,
      workspaceId,
      principalType,
      principalId,
      agentDefinitionId,
    });

    expect(bindings).toHaveLength(1);
    const [binding] = bindings;
    if (!binding) throw new Error('Expected exactly one binding.');
    // The regression this guards: a bare `SELECT d.id,...,v.id,...` collapses
    // to one `id` column in the pg driver's row object, so `mapDefinition`
    // and `mapVersion` both read the version's id. That made
    // `product_work_create` fail with "Work Definition lineage is invalid"
    // for every Coworker that called `list_agent_workflows` then tried to
    // act on the id it returned.
    expect(binding.definition.id).toBe(definitionId);
    expect(binding.version.id).toBe(versionId);
    expect(binding.definition.id).not.toBe(binding.version.id);
    expect(binding.version.definitionId).toBe(definitionId);
  });
});
