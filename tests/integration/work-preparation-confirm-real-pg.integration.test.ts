import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { AccessContext } from '../../src/domain/access-context.js';
import type { Work } from '../../src/domain/work/work.js';
import { PostgresWorkPreparationRepository } from '../../src/infrastructure/postgres/postgres-work-preparation-repository.js';
import { WorkPreparationService } from '../../src/application/work/work-preparation-service.js';

const connectionString =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL;
const describeReal = connectionString ? describe : describe.skip;

describeReal('Work preparation confirmation on real PostgreSQL', () => {
  const schema = `work_preparation_confirm_${randomUUID().replaceAll('-', '')}`;
  const tenantId = 'work-preparation-confirm-real-pg';
  const workspaceId = 'd1111111-1111-4111-8111-111111111111';
  const workId = 'd2222222-2222-4222-8222-222222222222';
  const preparationId = 'd3333333-3333-4333-8333-333333333333';
  const versionId = 'd4444444-4444-4444-8444-444444444444';
  const at = '2026-09-09T00:00:00.000Z';
  const owner = { tenantId, workspaceId };
  const accessContext: AccessContext = {
    ...owner,
    principalType: 'service_account',
    principalId: 'work-preparation-confirm-real-pg',
    policySnapshotVersion: 'real-pg',
  };
  const work: Work = {
    id: workId,
    tenantId,
    workspaceId,
    definitionId: 'd5555555-5555-4555-8555-555555555555',
    currentDefinitionVersionId: versionId,
    title: 'Concurrent preparation confirmation',
    origin: 'created',
    archivedAt: null,
    createdAt: at,
    updatedAt: at,
  };
  let pool!: Pool;

  beforeAll(async () => {
    pool = new Pool({
      connectionString,
      max: 8,
      options: `-c search_path="${schema}"`,
    });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(`
      CREATE TABLE works (
        id uuid PRIMARY KEY, tenant_id text NOT NULL, workspace_id uuid NOT NULL,
        current_definition_version_id uuid NOT NULL, UNIQUE(id, tenant_id, workspace_id)
      );
      CREATE TABLE work_runs (
        id uuid PRIMARY KEY, tenant_id text NOT NULL, workspace_id uuid NOT NULL, work_id uuid NOT NULL,
        definition_version_id uuid NOT NULL, trigger_kind text NOT NULL, trigger_ref text NOT NULL,
        idempotency_key text NOT NULL, root_task_id uuid NULL, expires_at timestamptz NOT NULL,
        bound_at timestamptz NULL, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
        UNIQUE(tenant_id, workspace_id, idempotency_key), UNIQUE(id, tenant_id, workspace_id, work_id)
      );
      CREATE TABLE work_chat_messages (
        id uuid PRIMARY KEY, tenant_id text NOT NULL, workspace_id uuid NOT NULL, work_id uuid NOT NULL,
        kind text NOT NULL, status text NOT NULL
      );
      CREATE TABLE work_preparations (
        id uuid PRIMARY KEY, tenant_id text NOT NULL, workspace_id uuid NOT NULL, work_id uuid NOT NULL,
        revision integer NOT NULL, status text NOT NULL, definition_version_id uuid NOT NULL,
        schema_fingerprint text NOT NULL, candidate_input jsonb NOT NULL, confirmed_fingerprint text NULL,
        start_intent text NULL, work_run_id uuid NULL, source_message_id uuid NULL,
        missing text[] NOT NULL, ambiguities text[] NOT NULL, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
        UNIQUE(id, tenant_id, workspace_id, work_id), UNIQUE(tenant_id, workspace_id, work_id, revision)
      );
      CREATE UNIQUE INDEX work_preparations_one_active_per_work ON work_preparations(tenant_id, workspace_id, work_id) WHERE status IN ('collecting','ready','starting');
    `);
    await pool.query(
      `INSERT INTO works(id,tenant_id,workspace_id,current_definition_version_id) VALUES($1,$2,$3,$4)`,
      [workId, tenantId, workspaceId, versionId],
    );
    await pool.query(
      `INSERT INTO work_preparations
       (id,tenant_id,workspace_id,work_id,revision,status,definition_version_id,schema_fingerprint,candidate_input,missing,ambiguities,created_at,updated_at)
       VALUES($1,$2,$3,$4,1,'ready',$5,'schema','{"topic":"alpha"}'::jsonb,'{}','{}',$6,$6)`,
      [preparationId, tenantId, workspaceId, workId, versionId, at],
    );
  });

  afterAll(async () => {
    await pool?.end();
    if (connectionString) {
      const admin = new Pool({ connectionString });
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  it('admits one WorkRun for two concurrent confirmation requests', async () => {
    const repository = new PostgresWorkPreparationRepository(pool);
    const start = async (input: { triggerRef?: string }) => {
      if (!input.triggerRef) throw new Error('trigger_ref_required');
      const result = await pool.query<{ id: string }>(
        `INSERT INTO work_runs
         (id,tenant_id,workspace_id,work_id,definition_version_id,trigger_kind,trigger_ref,idempotency_key,expires_at,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,'manual',$6,$6,$7,$7,$7)
         ON CONFLICT (tenant_id,workspace_id,idempotency_key) DO UPDATE SET id=work_runs.id
         RETURNING id`,
        [
          randomUUID(),
          tenantId,
          workspaceId,
          workId,
          versionId,
          input.triggerRef,
          at,
        ],
      );
      return {
        workRun: { id: result.rows[0]!.id } as never,
        executionReceipt: {
          reused: result.rows[0]!.id !== undefined,
          taskId: 'task',
        },
      };
    };
    const app = new WorkPreparationService({
      repository,
      identity: { findWorkById: async () => work },
      schemaForVersion: async () => ({
        schema: {
          type: 'object',
          properties: { topic: { type: 'string' } },
          required: ['topic'],
          additional_properties: false,
        },
      }),
      startWorkRun: { execute: start },
    });

    const results = await Promise.all([
      app.confirm({
        owner,
        accessContext,
        workId,
        preparationId,
        expectedRevision: 1,
      }),
      app.confirm({
        owner,
        accessContext,
        workId,
        preparationId,
        expectedRevision: 1,
      }),
    ]);
    const count = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM work_runs WHERE tenant_id=$1 AND workspace_id=$2 AND work_id=$3`,
      [tenantId, workspaceId, workId],
    );
    expect(
      results[0]!.preparation.workRunId ?? results[1]!.preparation.workRunId,
    ).toBeTruthy();
    expect(count.rows[0]!.count).toBe('1');
  });
});
