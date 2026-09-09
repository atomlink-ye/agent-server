import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import type { AccessContext } from '../../src/domain/access-context.js';
import { ProductWorkDefinitionApi } from '../../src/application/work/product-work-definition-api.js';
import { ResolveWorkDefinition } from '../../src/application/work/resolve-work-definition.js';
import { createWorkModule } from '../../src/composition/create-work-capabilities.js';
import { PostgresExecutionFactQuery } from '../../src/infrastructure/postgres/postgres-execution-fact-query.js';
import { PostgresWorkDefinitionSourceRepository } from '../../src/infrastructure/postgres/postgres-work-definition-source-repository.js';
import {
  applyDurableKernelMigrations,
  createPostgresPool,
} from '../../src/infrastructure/postgres/postgres.js';

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!connectionString)
  throw new Error(
    'real PostgreSQL integration requires DATABASE_URL or POSTGRES_URL',
  );

const tenantId = 'work-preparation-cross-principal-real-pg';
const workspaceId = 'd1111111-1111-4111-8111-111111111111';
const workerVersionId = 'd2222222-2222-4222-8222-222222222222';
const environmentVersionId = 'd3333333-3333-4333-8333-333333333333';
const principalA: AccessContext = {
  tenantId,
  workspaceId,
  principalType: 'service_account',
  principalId: 'preparation-author-a',
  policySnapshotVersion: 'work-preparation-cross-principal-a-v1',
};
const principalB: AccessContext = {
  ...principalA,
  principalId: 'preparation-observer-b',
  policySnapshotVersion: 'work-preparation-cross-principal-b-v1',
};
const at = '2026-09-09T00:00:00.000Z';

function assertAuthorOwner(owner: any): void {
  expect(owner).toMatchObject({
    tenantId,
    workspaceId,
    principalType: principalA.principalType,
    principalId: principalA.principalId,
  });
}

const SOURCE = `apiVersion: agentserver.dev/v1alpha1
kind: WorkDefinition
metadata:
  name: cross-principal-preparation
  description: Prepare a Work with an input collected by another principal.
spec:
  kind: single_worker
  worker_version_id: ${workerVersionId}
  environment_version_id: ${environmentVersionId}
  input_schema:
    type: object
    properties:
      symbol:
        type: string
    required: [symbol]
    additional_properties: false
`;

describe('Cross-principal Work preparation on real PostgreSQL', () => {
  let pool: Pool;
  const createdWorkIds: string[] = [];
  const createdTaskIds: string[] = [];

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
      [
        workspaceId,
        tenantId,
        principalA.principalType,
        principalA.principalId,
        'Cross-principal preparation workspace',
        at,
      ],
    );
  });

  afterAll(async () => {
    if (createdWorkIds.length) {
      await pool.query(
        'DELETE FROM work_preparations WHERE work_id = ANY($1::uuid[])',
        [createdWorkIds],
      );
      await pool.query(
        `DELETE FROM work_run_resource_manifest
         WHERE work_run_id IN (SELECT id FROM work_runs WHERE work_id = ANY($1::uuid[]))`,
        [createdWorkIds],
      );
      await pool.query(
        'DELETE FROM work_runs WHERE work_id = ANY($1::uuid[])',
        [createdWorkIds],
      );
      await pool.query('DELETE FROM works WHERE id = ANY($1::uuid[])', [
        createdWorkIds,
      ]);
    }
    if (createdTaskIds.length)
      await pool.query('DELETE FROM tasks WHERE id = ANY($1::uuid[])', [
        createdTaskIds,
      ]);
    await pool?.end();
  });

  it('prepares and starts an A-applied Definition through the composed path for principal B', async () => {
    const sources = new PostgresWorkDefinitionSourceRepository(pool);
    const workerResolution = {
      async resolvePublished(id: string, owner: any) {
        assertAuthorOwner(owner);
        return id === workerVersionId
          ? {
              source: 'worker' as const,
              id,
              definitionId: workerVersionId,
              workerOwner: principalA,
              instructions: 'Research the requested symbol.',
              modelPolicyRef: 'free-only' as const,
              proposalLimit: 0,
              skills: [],
              toolRefs: [],
            }
          : null;
      },
    } as any;
    const workers = {
      async findVersion(owner: unknown, id: string) {
        assertAuthorOwner(owner);
        return id === workerVersionId
          ? {
              id,
              definitionId: workerVersionId,
              tenantId,
              workspaceId,
              principalType: principalA.principalType,
              principalId: principalA.principalId,
              status: 'published' as const,
              fingerprint: `sha256:${'w'.repeat(64)}`,
            }
          : null;
      },
    };
    const environments = {
      async findVersion(owner: unknown, id: string) {
        assertAuthorOwner(owner);
        return id === environmentVersionId
          ? {
              id,
              status: 'published' as const,
              fingerprint: `sha256:${'e'.repeat(64)}`,
            }
          : null;
      },
    } as any;
    const invokables = {
      saveTeamDefinition: async () => undefined,
      findTeamDefinitionById: async () => null,
      saveTeamVersion: async () => undefined,
      findTeamVersionById: async () => null,
    };
    const resolver = new ResolveWorkDefinition({
      workers,
      workerResolution,
      definitions: invokables,
      environments,
      authoredDefinitions: sources,
      memories: { findVersion: async () => null },
    } as any);
    const product = new ProductWorkDefinitionApi({
      repository: sources,
      resolver,
      workers: workerResolution,
      invokables: invokables as any,
      environments,
      memories: { findVersion: async () => null },
      now: () => new Date(at),
    });

    const applied = await product.apply({
      source: SOURCE,
      idempotencyKey: 'cross-principal-preparation-apply',
      accessContext: principalA,
    });
    const workModule = createWorkModule({
      database: pool as any,
      definitions: invokables as any,
      definitionResolution: resolver,
      execution: {
        admitRoot: async (request: any) => {
          const taskId = randomUUID();
          await pool.query(
            `INSERT INTO tasks
             (id,tenant_id,workspace_id,principal_type,principal_id,
              policy_snapshot_version,root_task_id,depth,status,ingress,
              invokable_kind,invokable_version_id,input_snapshot_ref,input_fingerprint,
              created_at,updated_at)
             VALUES($1,$2,$3,$4,$5,$6,$1,0,'active','api',$7,$8,'preparation','preparation',$9,$9)`,
            [
              taskId,
              tenantId,
              workspaceId,
              principalB.principalType,
              principalB.principalId,
              principalB.policySnapshotVersion,
              request.invokable.kind,
              request.invokable.versionId,
              at,
            ],
          );
          createdTaskIds.push(taskId);
          return { taskId, reused: false };
        },
      },
      runtimeCapabilities: {
        supported: new Set(['external_workspace']),
      },
      executionFacts: new PostgresExecutionFactQuery(pool as any),
    });
    const work = await workModule.identity.createWork({
      owner: { tenantId, workspaceId },
      definitionId: applied.definition.id,
      definitionVersionId: applied.version.version.id,
      title: 'Cross-principal preparation Work',
      accessContext: principalA,
    });
    createdWorkIds.push(work.id);

    const preparation = await workModule.preparation.observeLead({
      owner: { tenantId, workspaceId },
      workId: work.id,
      accessContext: principalB,
      candidateInput: { symbol: 'ACME' },
    });

    expect(preparation.status).toBe('ready');
    expect(preparation.missing).toEqual([]);
    expect(preparation.candidateInput).toEqual({ symbol: 'ACME' });

    const confirmed = await workModule.preparation.confirm({
      owner: { tenantId, workspaceId },
      accessContext: principalB,
      workId: work.id,
      preparationId: preparation.id,
      expectedRevision: preparation.revision,
    });

    expect(confirmed.preparation.status).toBe('started');
    expect(confirmed.workRun?.id).toBeDefined();
    expect(confirmed.workRun?.rootTaskId).toBe(createdTaskIds[0]);
  });
});
