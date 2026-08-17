import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { PostgresProductWorkListQuery } from '../../src/infrastructure/postgres/postgres-product-work-list-query.js';
import {
  applyDurableKernelMigrations,
  createPostgresPool,
} from '../../src/infrastructure/postgres/postgres.js';

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!connectionString)
  throw new Error(
    'real PostgreSQL integration requires DATABASE_URL or POSTGRES_URL',
  );

const tenantId = 'product_work_order_real_pg';
const workspaceId = 'c1111111-1111-4111-8111-111111111111';
const owner = { tenantId, workspaceId } as const;
const definitionId = 'c2222222-2222-4222-8222-222222222222';
const definitionVersionId = 'c3333333-3333-4333-8333-333333333333';
const workIds = [
  'c4000000-0000-4000-8000-000000000001',
  'c4000000-0000-4000-8000-000000000002',
  'c4000000-0000-4000-8000-000000000003',
] as const;
const runIds = [
  'c5000000-0000-4000-8000-000000000001',
  'c5000000-0000-4000-8000-000000000002',
  'c5000000-0000-4000-8000-000000000003',
] as const;

describe('Product Work latest-first list semantics on real PostgreSQL', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createPostgresPool({ connectionString: connectionString!, maxConnections: 2 });
    await applyDurableKernelMigrations(pool);
    await pool.query(
      `INSERT INTO workspaces
       (id,tenant_id,principal_type,principal_id,name,created_at,updated_at)
       VALUES($1,$2,'service_account',$3,$4,$5,$5)
       ON CONFLICT (id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id,updated_at=EXCLUDED.updated_at`,
      [workspaceId, tenantId, 'product-work-order', 'Product Work Order', '2026-08-17T00:00:00.000Z'],
    );
    await pool.query('DELETE FROM work_runs WHERE work_id = ANY($1::uuid[])', [workIds]);
    await pool.query('DELETE FROM works WHERE id = ANY($1::uuid[])', [workIds]);

    for (const [index, id] of workIds.entries()) {
      const createdAt = `2026-08-17T0${index}:00:00.000Z`;
      const updatedAt = `2026-08-17T1${index}:00:00.000Z`;
      await pool.query(
        `INSERT INTO works
         (id,tenant_id,workspace_id,definition_id,current_definition_version_id,title,origin,archived_at,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,'created',NULL,$7,$8)`,
        [id, tenantId, workspaceId, definitionId, definitionVersionId, `Work ${index + 1}`, createdAt, updatedAt],
      );
    }

    for (const [index, id] of runIds.entries()) {
      const createdAt = `2026-08-17T0${index}:30:00.000Z`;
      await pool.query(
        `INSERT INTO work_runs
         (id,tenant_id,workspace_id,work_id,definition_version_id,trigger_kind,trigger_ref,idempotency_key,root_task_id,expires_at,bound_at,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,'manual',$6,$7,NULL,$8,NULL,$9,$9)`,
        [
          id,
          tenantId,
          workspaceId,
          workIds[2],
          definitionVersionId,
          `run-${index + 1}`,
          `product-work-order-${index + 1}`,
          '2099-01-01T00:00:00.000Z',
          createdAt,
        ],
      );
    }
  });

  afterAll(async () => {
    await pool?.query('DELETE FROM work_runs WHERE work_id = ANY($1::uuid[])', [workIds]);
    await pool?.query('DELETE FROM works WHERE id = ANY($1::uuid[])', [workIds]);
    await pool?.query('DELETE FROM workspaces WHERE id=$1 AND tenant_id=$2', [workspaceId, tenantId]);
    await pool?.end();
  });

  it('paginates Work by updated_at descending with a seek cursor', async () => {
    const query = new PostgresProductWorkListQuery(pool);
    const first = await query.listWorksLatestFirst(owner, { limit: 2, cursor: null });
    expect(first.items.map((work) => work.id)).toEqual([workIds[2], workIds[1]]);
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = await query.listWorksLatestFirst(owner, {
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.items.map((work) => work.id)).toEqual([workIds[0]]);
    expect(second.nextCursor).toBeNull();
  });

  it('paginates WorkRun by created_at descending with a Work-scoped cursor', async () => {
    const query = new PostgresProductWorkListQuery(pool);
    const first = await query.listWorkRunsLatestFirst(owner, workIds[2], {
      limit: 2,
      cursor: null,
    });
    expect(first.items.map((run) => run.id)).toEqual([runIds[2], runIds[1]]);
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = await query.listWorkRunsLatestFirst(owner, workIds[2], {
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.items.map((run) => run.id)).toEqual([runIds[0]]);
    expect(second.nextCursor).toBeNull();
  });
});
