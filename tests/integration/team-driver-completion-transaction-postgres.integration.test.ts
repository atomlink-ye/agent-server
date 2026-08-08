import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

import { TeamDriver } from '../../src/application/teams/team-driver.js';
import {
  decodeRootTaskRunRequestSnapshotRef,
  encodeRootTaskRunRequestSnapshotRef,
} from '../../src/application/tasks/root-task-input.js';
import { PostgresAdmissionRepository } from '../../src/infrastructure/postgres/postgres-admission-repository.js';
import { PostgresTaskRepository } from '../../src/infrastructure/postgres/postgres-task-repository.js';
import { PostgresRunRepository } from '../../src/infrastructure/postgres/postgres-run-repository.js';
import { PostgresTeamExecutionRepository } from '../../src/infrastructure/postgres/postgres-collaborative-team-repository.js';
import { applyDurableKernelMigrations } from '../../src/infrastructure/postgres/postgres.js';

const owner = {
  tenantId: 'tenant_driver_tx',
  workspaceId: 'workspace_driver_tx',
  principalType: 'service_account',
  principalId: 'svc_driver_tx',
} as const;

const ids = {
  teamRun: '00000000-0000-4000-8000-000000009209',
  rootTask: '00000000-0000-4000-8000-000000009201',
  rootRun: '00000000-0000-4000-8000-000000009202',
  leadMember: '00000000-0000-4000-8000-000000009203',
  leadTask: '00000000-0000-4000-8000-000000009204',
  requestRun: '00000000-0000-4000-8000-000000009205',
  member: '00000000-0000-4000-8000-000000009206',
  workItem: '00000000-0000-4000-8000-000000009207',
  attempt: '00000000-0000-4000-8000-000000009208',
} as const;

const timestamp = '2026-08-08T00:00:00.000Z';
const rootSnapshot = encodeRootTaskRunRequestSnapshotRef({
  prompt: 'root prompt',
});
const leadSnapshot = encodeRootTaskRunRequestSnapshotRef({
  prompt: 'lead request prompt',
});

async function seed(database: PGlite): Promise<void> {
  await database.query(
    `INSERT INTO tasks(
      id,root_task_id,parent_task_id,parent_run_id,depth,status,ingress,
      invokable_kind,invokable_version_id,input_snapshot_ref,input_fingerprint,
      created_at,updated_at,tenant_id,workspace_id,principal_type,principal_id,
      policy_snapshot_version
    ) VALUES ($1,$1,NULL,NULL,0,'completed','api','team',$2,$3,'root-fingerprint',$4,$4,$5,$6,$7,$8,'policy-driver-tx')`,
    [
      ids.rootTask,
      '00000000-0000-4000-8000-000000009210',
      rootSnapshot,
      timestamp,
      owner.tenantId,
      owner.workspaceId,
      owner.principalType,
      owner.principalId,
    ],
  );
  await database.query(
    `INSERT INTO runs(
      id,task_id,attempt,status,fencing_token,result,created_at,updated_at
    ) VALUES ($1,$2,1,'succeeded',1,$3::jsonb,$4,$4)`,
    [ids.rootRun, ids.rootTask, '{"text":"root"}', timestamp],
  );
  await database.query(
    `INSERT INTO team_runs(
      id,tenant_id,workspace_id,principal_type,principal_id,root_task_id,
      root_run_id,team_version_id,environment_version_id,status,phase,final_text,
      control_state,revision,lead_turn_count,completion_requested_by_run_id,
      completion_approval_required,created_at,updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active','lead_finalize',NULL,
      'lead_running',7,4,$10,true,$11,$11)`,
    [
      ids.teamRun,
      owner.tenantId,
      owner.workspaceId,
      owner.principalType,
      owner.principalId,
      ids.rootTask,
      ids.rootRun,
      '00000000-0000-4000-8000-000000009211',
      '00000000-0000-4000-8000-000000009212',
      ids.requestRun,
      timestamp,
    ],
  );
  await database.query(
    `INSERT INTO team_member_runs(
      id,team_run_id,name,role,agent_version_id,status,tenant_id,workspace_id,
      principal_type,principal_id,created_at,updated_at
    ) VALUES
      ($1,$3,'lead','lead',$4,'active',$6,$7,$8,$9,$10,$10),
      ($2,$3,'worker','member',$5,'active',$6,$7,$8,$9,$10,$10)`,
    [
      ids.leadMember,
      ids.member,
      ids.teamRun,
      '00000000-0000-4000-8000-000000009213',
      '00000000-0000-4000-8000-000000009214',
      owner.tenantId,
      owner.workspaceId,
      owner.principalType,
      owner.principalId,
      timestamp,
    ],
  );
  await database.query(
    `INSERT INTO tasks(
      id,root_task_id,parent_task_id,parent_run_id,depth,status,ingress,
      invokable_kind,invokable_version_id,input_snapshot_ref,input_fingerprint,
      created_at,updated_at,tenant_id,workspace_id,principal_type,principal_id,
      policy_snapshot_version,logical_step_key,node_path,team_task_kind,
      team_member_run_id
    ) VALUES ($1,$2,$2,$3,1,'completed','api','agent',$4,$5,
      'lead-request-fingerprint',$6,$6,$7,$8,$9,$10,'policy-driver-tx',
      'lead-request','lead','lead_turn',$11)`,
    [
      ids.leadTask,
      ids.rootTask,
      ids.rootRun,
      '00000000-0000-4000-8000-000000009215',
      leadSnapshot,
      timestamp,
      owner.tenantId,
      owner.workspaceId,
      owner.principalType,
      owner.principalId,
      ids.leadMember,
    ],
  );
  await database.query(
    `INSERT INTO runs(
      id,task_id,attempt,status,fencing_token,result,created_at,updated_at
    ) VALUES ($1,$2,1,'succeeded',1,$3::jsonb,$4,$4)`,
    [
      ids.requestRun,
      ids.leadTask,
      '{"text":"completion request output"}',
      timestamp,
    ],
  );
  await database.query(
    `INSERT INTO team_work_items(
      id,team_run_id,subject,description,status,owner_member_id,created_by_member_id,
      completion_summary,execution_task_id,tenant_id,workspace_id,principal_type,
      principal_id,created_at,updated_at,completed_at
    ) VALUES ($1,$2,'API contract','contract work','accepted',$3,$4,'done',NULL,
      $5,$6,$7,$8,$9,$9,$9)`,
    [
      ids.workItem,
      ids.teamRun,
      ids.member,
      ids.leadMember,
      owner.tenantId,
      owner.workspaceId,
      owner.principalType,
      owner.principalId,
      timestamp,
    ],
  );
  await database.query(
    `INSERT INTO team_work_item_attempts(
      id,work_item_id,team_run_id,attempt_no,assignee_member_id,
      requested_by_lead_task_id,feedback,execution_task_id,status,result_summary,
      tenant_id,workspace_id,principal_type,principal_id,created_at,updated_at,completed_at
    ) VALUES ($1,$2,$3,1,$4,$5,NULL,NULL,'completed','done',$6,$7,$8,$9,$10,$10,$10)`,
    [
      ids.attempt,
      ids.workItem,
      ids.teamRun,
      ids.member,
      ids.leadTask,
      owner.tenantId,
      owner.workspaceId,
      owner.principalType,
      owner.principalId,
      timestamp,
    ],
  );
}

function createDriver(database: PGlite): TeamDriver {
  const executions = new PostgresTeamExecutionRepository(database);
  return new TeamDriver(
    executions,
    new PostgresTaskRepository(database),
    new PostgresRunRepository(database),
    new PostgresAdmissionRepository(database),
    undefined,
    undefined,
    () => new Date('2026-08-08T00:05:00.000Z'),
  );
}

async function createDatabase(): Promise<PGlite> {
  const database = new PGlite();
  await applyDurableKernelMigrations(database);
  await seed(database);
  return database;
}

const rejectInput = {
  teamRunId: ids.teamRun,
  expectedRevision: 7,
  owner,
  decidedBy: 'svc_reviewer',
  decision: 'reject' as const,
  feedback: 'Please address the API contract.',
  workItemIds: [ids.workItem],
};

describe('TeamDriver completion rejection transaction (PGlite)', () => {
  it('commits rejection, lead advance, next Lead task/run, and dispatch together', async () => {
    const database = await createDatabase();
    const driver = createDriver(database);

    const result = await driver.decideCompletion(rejectInput);
    const team = await database.query<{
      revision: number;
      lead_turn_count: number;
      completion_requested_by_run_id: string | null;
    }>(
      `SELECT revision,lead_turn_count,completion_requested_by_run_id
         FROM team_runs WHERE id=$1`,
      [ids.teamRun],
    );
    const decisions = await database.query<{
      decision: string;
      feedback: string;
    }>(
      `SELECT decision,feedback FROM team_completion_decisions WHERE team_run_id=$1`,
      [ids.teamRun],
    );
    const leadTasks = await database.query<{
      id: string;
      input_snapshot_ref: string;
    }>(
      `SELECT id,input_snapshot_ref FROM tasks
         WHERE team_member_run_id=$1 AND team_task_kind='lead_turn' AND id <> $2`,
      [ids.leadMember, ids.leadTask],
    );
    const leadRuns = await database.query<{ id: string; task_id: string }>(
      `SELECT r.id,r.task_id FROM runs r JOIN tasks t ON t.id=r.task_id
         WHERE t.team_member_run_id=$1 AND t.team_task_kind='lead_turn' AND r.id <> $2`,
      [ids.leadMember, ids.requestRun],
    );
    const dispatches = await database.query<{ run_id: string }>(
      `SELECT run_id FROM run_dispatches WHERE run_id=$1`,
      [leadRuns.rows?.[0]?.id],
    );
    const leadRun = await new PostgresRunRepository(database).findByIdForOwner(
      leadRuns.rows?.[0]?.id ?? '',
      owner,
    );

    expect(result.decision.feedback).toBe(rejectInput.feedback);
    expect(result.team.revision).toBe(9);
    expect(team.rows).toEqual([
      {
        revision: 9,
        lead_turn_count: 5,
        completion_requested_by_run_id: ids.requestRun,
      },
    ]);
    expect(decisions.rows).toEqual([
      { decision: 'reject', feedback: rejectInput.feedback },
    ]);
    expect(leadTasks.rows).toHaveLength(1);
    expect(
      decodeRootTaskRunRequestSnapshotRef(leadTasks.rows[0]!.input_snapshot_ref)
        .prompt,
    ).toContain(rejectInput.feedback);
    expect(leadRun?.prompt).toContain(rejectInput.feedback);
    expect(leadRuns.rows).toHaveLength(1);
    expect(dispatches.rows).toEqual([{ run_id: leadRuns.rows[0]!.id }]);
  });

  it('replays an exact rejection without advancing or enqueueing a second Lead', async () => {
    const database = await createDatabase();
    const driver = createDriver(database);

    const first = await driver.decideCompletion(rejectInput);
    const replay = await driver.decideCompletion(rejectInput);
    const team = await database.query<{
      revision: number;
      lead_turn_count: number;
    }>(`SELECT revision,lead_turn_count FROM team_runs WHERE id=$1`, [
      ids.teamRun,
    ]);
    const decisions = await database.query(
      `SELECT 1 FROM team_completion_decisions WHERE team_run_id=$1`,
      [ids.teamRun],
    );
    const leadTasks = await database.query(
      `SELECT 1 FROM tasks
         WHERE team_member_run_id=$1 AND team_task_kind='lead_turn' AND id <> $2`,
      [ids.leadMember, ids.leadTask],
    );
    const leadRuns = await database.query(
      `SELECT 1 FROM runs r JOIN tasks t ON t.id=r.task_id
         WHERE t.team_member_run_id=$1 AND t.team_task_kind='lead_turn' AND r.id <> $2`,
      [ids.leadMember, ids.requestRun],
    );
    const dispatches = await database.query(
      `SELECT 1 FROM run_dispatches WHERE run_id IN (
         SELECT r.id FROM runs r JOIN tasks t ON t.id=r.task_id
         WHERE t.team_member_run_id=$1 AND t.team_task_kind='lead_turn' AND r.id <> $2
       )`,
      [ids.leadMember, ids.requestRun],
    );

    expect(replay.decision).toEqual(first.decision);
    expect(replay.team).toMatchObject({ revision: 9, leadTurnCount: 5 });
    expect(team.rows).toEqual([{ revision: 9, lead_turn_count: 5 }]);
    expect(decisions.rows).toHaveLength(1);
    expect(leadTasks.rows).toHaveLength(1);
    expect(leadRuns.rows).toHaveLength(1);
    expect(dispatches.rows).toHaveLength(1);
  });

  it('rolls back every rejection side effect when dispatch enqueue fails', async () => {
    const database = await createDatabase();
    await database.query(`
      CREATE OR REPLACE FUNCTION test_reject_dispatch_insert()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'forced dispatch failure';
      END;
      $$ LANGUAGE plpgsql;
    `);
    await database.query(`
      CREATE TRIGGER test_reject_dispatch_insert
        BEFORE INSERT ON run_dispatches
        FOR EACH ROW EXECUTE FUNCTION test_reject_dispatch_insert()
    `);
    const driver = createDriver(database);

    await expect(driver.decideCompletion(rejectInput)).rejects.toThrow(
      'forced dispatch failure',
    );
    const team = await database.query<{
      revision: number;
      lead_turn_count: number;
      completion_requested_by_run_id: string | null;
    }>(
      `SELECT revision,lead_turn_count,completion_requested_by_run_id FROM team_runs WHERE id=$1`,
      [ids.teamRun],
    );
    const decisions = await database.query(
      `SELECT 1 FROM team_completion_decisions WHERE team_run_id=$1`,
      [ids.teamRun],
    );
    const leadTasks = await database.query(
      `SELECT 1 FROM tasks WHERE team_member_run_id=$1 AND team_task_kind='lead_turn' AND id <> $2`,
      [ids.leadMember, ids.leadTask],
    );
    const leadRuns = await database.query(
      `SELECT 1 FROM runs r JOIN tasks t ON t.id=r.task_id
         WHERE t.team_member_run_id=$1 AND r.id <> $2`,
      [ids.leadMember, ids.requestRun],
    );
    const dispatches = await database.query(`SELECT 1 FROM run_dispatches`);

    expect(team.rows).toEqual([
      {
        revision: 7,
        lead_turn_count: 4,
        completion_requested_by_run_id: ids.requestRun,
      },
    ]);
    expect(decisions.rows).toEqual([]);
    expect(leadTasks.rows).toEqual([]);
    expect(leadRuns.rows).toEqual([]);
    expect(dispatches.rows).toEqual([]);
  });
});
