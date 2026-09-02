import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresWorkOrganizationRepository } from '../../src/infrastructure/postgres/postgres-work-organization-repository.js';
import {
  applyDurableKernelMigrations,
  createPostgresPool,
} from '../../src/infrastructure/postgres/postgres.js';

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!connectionString)
  throw new Error(
    'real PostgreSQL integration requires DATABASE_URL or POSTGRES_URL',
  );

const tenantId = 'work_item_claim_race_tenant';
const workspaceId = 'c1111111-1111-4111-8111-111111111111';
const principalId = 'work-item-claim-race';
const at = '2026-09-01T00:00:00.000Z';
const claimantCount = 16;

/**
 * The claim race, on the engine that actually arbitrates it. PGlite is
 * single-connection, so a lost UPDATE could never be observed there: this suite
 * is the only place where "exactly one claimant wins" is really tested.
 */
describe('WorkItem claim race on real PostgreSQL', () => {
  const schema = `work_item_claim_race_${randomUUID().replaceAll('-', '')}`;
  let admin!: Pool;
  let pool!: Pool;
  let boardId!: string;
  let todoColumnId!: string;
  let doingColumnId!: string;

  beforeAll(async () => {
    admin = createPostgresPool({
      connectionString: connectionString!,
      maxConnections: 1,
    });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString,
      // Every claimant needs its own connection, otherwise they queue and the
      // race never happens.
      max: claimantCount,
      options: `-c search_path="${schema}"`,
    });
    await applyDurableKernelMigrations(pool);
    await pool.query(
      `INSERT INTO workspaces
       (id,tenant_id,principal_type,principal_id,name,created_at,updated_at)
       VALUES($1,$2,'service_account',$3,'Claim Race',$4,$4)`,
      [workspaceId, tenantId, principalId, at],
    );
    boardId = randomUUID();
    todoColumnId = randomUUID();
    doingColumnId = randomUUID();
    await pool.query(
      `INSERT INTO product_work_boards
       (id,tenant_id,workspace_id,title,description,created_by,created_at,updated_at)
       VALUES($1,$2,$3,'增长看板',NULL,$4,$5,$5)`,
      [boardId, tenantId, workspaceId, principalId, at],
    );
    await pool.query(
      `INSERT INTO product_work_board_columns
       (id,tenant_id,workspace_id,board_id,title,position,kind,created_at,updated_at)
       VALUES($1,$3,$4,$5,'待办',0,'todo',$6,$6),
              ($2,$3,$4,$5,'进行中',1,'doing',$6,$6)`,
      [todoColumnId, doingColumnId, tenantId, workspaceId, boardId, at],
    );
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  it('lets exactly one of many concurrent claimants win and moves the card once', async () => {
    const repository = new PostgresWorkOrganizationRepository(pool);
    const workItemId = randomUUID();
    await pool.query(
      `INSERT INTO product_work_items
       (id,tenant_id,workspace_id,title,description,status,assignee_id,mentions,
        created_by,source_conversation_id,source_message_id,linked_work_id,
        created_at,updated_at)
       VALUES($1,$2,$3,'核对上周的转化数据',NULL,'todo',NULL,'[]'::jsonb,$4,
              NULL,NULL,NULL,$5,$5)`,
      [workItemId, tenantId, workspaceId, principalId, at],
    );
    await pool.query(
      `INSERT INTO product_work_board_placements
       (tenant_id,workspace_id,board_id,column_id,work_item_id,position,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,0,$6,$6)`,
      [tenantId, workspaceId, boardId, todoColumnId, workItemId, at],
    );

    const now = new Date().toISOString();
    const results = await Promise.all(
      Array.from({ length: claimantCount }, (_, index) =>
        repository.claimWorkItem({
          tenantId,
          workspaceId,
          workItemId,
          claimantId: `agent-${index}`,
          staleAfterMinutes: 20,
          now,
        }),
      ),
    );

    const winners = results.filter((result) => result.workItem !== null);
    expect(winners).toHaveLength(1);
    const winner = winners[0]!;
    // The losers must all name the same holder, and none of them may report a
    // move: a loser that thinks it moved the card would desync the board.
    for (const loser of results.filter((result) => result.workItem === null)) {
      expect(loser.holderId).toBe(winner.workItem?.assigneeId);
      expect(loser.movedToColumnId).toBeNull();
    }
    expect(winner.movedToColumnId).toBe(doingColumnId);

    const stored = await pool.query<{ assignee_id: string; column_id: string }>(
      `SELECT items.assignee_id, placements.column_id
         FROM product_work_items AS items
         JOIN product_work_board_placements AS placements
           ON placements.work_item_id=items.id
        WHERE items.id=$1`,
      [workItemId],
    );
    expect(stored.rows[0]?.assignee_id).toBe(winner.workItem?.assigneeId);
    expect(stored.rows[0]?.column_id).toBe(doingColumnId);
  });

  it('hands a stale claim to the next claimant without moving it backwards', async () => {
    const repository = new PostgresWorkOrganizationRepository(pool);
    const workItemId = randomUUID();
    const stale = '2026-09-01T00:00:00.000Z';
    await pool.query(
      `INSERT INTO product_work_items
       (id,tenant_id,workspace_id,title,description,status,assignee_id,mentions,
        created_by,source_conversation_id,source_message_id,linked_work_id,
        created_at,updated_at)
       VALUES($1,$2,$3,'补齐渠道归因','', 'in_progress','agent-crashed','[]'::jsonb,
              $4,NULL,NULL,NULL,$5,$5)`,
      [workItemId, tenantId, workspaceId, principalId, stale],
    );
    // Already in Doing: the rescue claim must not drag it anywhere, because the
    // only allowed move is Todo -> Doing.
    await pool.query(
      `INSERT INTO product_work_board_placements
       (tenant_id,workspace_id,board_id,column_id,work_item_id,position,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,1,$6,$6)`,
      [tenantId, workspaceId, boardId, doingColumnId, workItemId, stale],
    );

    const rescued = await repository.claimWorkItem({
      tenantId,
      workspaceId,
      workItemId,
      claimantId: 'agent-rescuer',
      staleAfterMinutes: 20,
      now: '2026-09-01T02:00:00.000Z',
    });
    expect(rescued.workItem?.assigneeId).toBe('agent-rescuer');
    expect(rescued.movedToColumnId).toBeNull();
  });
});
