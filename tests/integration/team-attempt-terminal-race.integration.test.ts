import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  TeamExecutionError,
  type OwnerScope,
} from '../../src/application/ports/team-execution-repository.js';
import { PostgresTeamExecutionRepository } from '../../src/infrastructure/postgres/postgres-collaborative-team-repository.js';
import {
  applyDurableKernelMigrations,
  createPostgresPool,
} from '../../src/infrastructure/postgres/postgres.js';

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!connectionString) {
  throw new Error(
    'real PostgreSQL integration requires DATABASE_URL or POSTGRES_URL',
  );
}

type Fixture = {
  owner: OwnerScope;
  teamRunId: string;
  rootTaskId: string;
  rootRunId: string;
  leadMemberId: string;
  memberId: string;
  leadTaskId: string;
  childTaskId: string;
  childRunId: string;
  workItemId: string;
  attemptId: string;
};

const timeout = async <T>(promise: Promise<T>, milliseconds: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`terminal race exceeded ${milliseconds}ms`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

async function seedFixture(
  database: Pool,
  childStatus: 'running' | 'succeeded',
): Promise<Fixture> {
  const fixture: Fixture = {
    owner: {
      tenantId: `team_attempt_race_${randomUUID()}`,
      workspaceId: randomUUID(),
      principalType: 'service_account',
      principalId: 'team-attempt-race-owner',
    },
    teamRunId: randomUUID(),
    rootTaskId: randomUUID(),
    rootRunId: randomUUID(),
    leadMemberId: randomUUID(),
    memberId: randomUUID(),
    leadTaskId: randomUUID(),
    childTaskId: randomUUID(),
    childRunId: randomUUID(),
    workItemId: randomUUID(),
    attemptId: randomUUID(),
  };
  const timestamp = '2026-08-11T00:00:00.000Z';
  const childActivationId = randomUUID();
  const owner = fixture.owner;

  await database.query(
    `INSERT INTO tasks(
      id,root_task_id,parent_task_id,parent_run_id,depth,status,ingress,
      invokable_kind,invokable_version_id,input_snapshot_ref,input_fingerprint,
      created_at,updated_at,tenant_id,workspace_id,principal_type,principal_id,
      policy_snapshot_version
    ) VALUES ($1,$1,NULL,NULL,0,'active','api','team',$2,'race-root','race-root',$3,$3,$4,$5,$6,$7,'race-policy')`,
    [
      fixture.rootTaskId,
      randomUUID(),
      timestamp,
      owner.tenantId,
      owner.workspaceId,
      owner.principalType,
      owner.principalId,
    ],
  );
  await database.query(
    `INSERT INTO runs(
      id,task_id,attempt,status,lease_owner,activation_id,lease_expires_at,
      fencing_token,result,error,created_at,updated_at
    ) VALUES ($1,$2,1,'waiting_children',NULL,NULL,NULL,1,NULL,NULL,$3,$3)`,
    [fixture.rootRunId, fixture.rootTaskId, timestamp],
  );
  await database.query(
    `INSERT INTO run_events(id,run_id,sequence,type,payload,created_at)
       VALUES ($1,$2,1,'started','{}'::jsonb,$3)`,
    [randomUUID(), fixture.rootRunId, timestamp],
  );
  await database.query(
    `INSERT INTO team_runs(
      id,tenant_id,workspace_id,principal_type,principal_id,root_task_id,
      root_run_id,team_version_id,environment_version_id,status,phase,final_text,
      control_state,revision,lead_turn_count,completion_requested_by_run_id,
      completion_approval_required,created_at,updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active','member_work',NULL,
      'member_work_running',1,1,NULL,false,$10,$10)`,
    [
      fixture.teamRunId,
      owner.tenantId,
      owner.workspaceId,
      owner.principalType,
      owner.principalId,
      fixture.rootTaskId,
      fixture.rootRunId,
      randomUUID(),
      randomUUID(),
      timestamp,
    ],
  );
  await database.query(
    `INSERT INTO team_member_runs(
      id,team_run_id,name,role,agent_version_id,status,tenant_id,workspace_id,
      principal_type,principal_id,created_at,updated_at
    ) VALUES
      ($1,$3,'race-lead','lead',$4,'active',$6,$7,$8,$9,$10,$10),
      ($2,$3,'race-worker','member',$5,'active',$6,$7,$8,$9,$10,$10)`,
    [
      fixture.leadMemberId,
      fixture.memberId,
      fixture.teamRunId,
      randomUUID(),
      randomUUID(),
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
    ) VALUES
      ($1,$2,$2,$3,1,'active','api','agent',$4,'race-lead','race-lead',$5,$5,$6,$7,$8,$9,'race-policy','race-lead','race-lead','lead_turn',$10),
      ($11,$2,$2,$3,1,'active','api','agent',$12,'race-child','race-child',$5,$5,$6,$7,$8,$9,'race-policy','race-child','race-child','work_attempt',$13)`,
    [
      fixture.leadTaskId,
      fixture.rootTaskId,
      fixture.rootRunId,
      randomUUID(),
      timestamp,
      owner.tenantId,
      owner.workspaceId,
      owner.principalType,
      owner.principalId,
      fixture.leadMemberId,
      fixture.childTaskId,
      randomUUID(),
      fixture.memberId,
    ],
  );
  await database.query(
    `INSERT INTO runs(
      id,task_id,attempt,status,lease_owner,activation_id,lease_expires_at,
      fencing_token,result,error,created_at,updated_at
    ) VALUES ($1,$2,1,$3,$4,$5,$6,1,$7::jsonb,NULL,$8,$8)`,
    [
      fixture.childRunId,
      fixture.childTaskId,
      childStatus,
      childStatus === 'running' ? 'race-worker' : null,
      childStatus === 'running' ? childActivationId : null,
      childStatus === 'running' ? '2026-08-11T01:00:00.000Z' : null,
      childStatus === 'running' ? null : '{"text":"provider done"}',
      timestamp,
    ],
  );
  await database.query(
    `INSERT INTO team_work_items(
      id,team_run_id,subject,description,status,owner_member_id,created_by_member_id,
      completion_summary,execution_task_id,tenant_id,workspace_id,principal_type,
      principal_id,created_at,updated_at,completed_at
    ) VALUES ($1,$2,'race work','provider output','in_progress',$3,$4,NULL,$5,
      $6,$7,$8,$9,$10,$10,NULL)`,
    [
      fixture.workItemId,
      fixture.teamRunId,
      fixture.memberId,
      fixture.leadMemberId,
      fixture.childTaskId,
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
    ) VALUES ($1,$2,$3,1,$4,$5,NULL,$6,'running',NULL,$7,$8,$9,$10,$11,$11,NULL)`,
    [
      fixture.attemptId,
      fixture.workItemId,
      fixture.teamRunId,
      fixture.memberId,
      fixture.leadTaskId,
      fixture.childTaskId,
      owner.tenantId,
      owner.workspaceId,
      owner.principalType,
      owner.principalId,
      timestamp,
    ],
  );

  return fixture;
}

function failureInput(fixture: Fixture) {
  return {
    teamRunId: fixture.teamRunId,
    rootRunId: fixture.rootRunId,
    rootTaskId: fixture.rootTaskId,
    owner: fixture.owner,
    updatedAt: '2026-08-11T00:05:00.000Z',
    stopReason: 'succeeded_without_submit' as const,
    attemptId: fixture.attemptId,
    childTaskId: fixture.childTaskId,
    childRunId: fixture.childRunId,
    failure: {
      code: 'runtime_execution_failed' as const,
      message:
        'The runtime completed successfully yet required canonical work submit did not occur.',
    },
  };
}

describe('Team attempt terminal race (real PostgreSQL)', () => {
  const schema = `team_attempt_race_${randomUUID().replaceAll('-', '')}`;
  let admin: Pool | undefined;
  let poolA: Pool | undefined;
  let poolB: Pool | undefined;

  beforeAll(async () => {
    admin = createPostgresPool({
      connectionString: connectionString!,
      maxConnections: 1,
    });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    poolA = new Pool({
      connectionString,
      max: 1,
      options: `-c search_path="${schema}"`,
    });
    poolB = new Pool({
      connectionString,
      max: 1,
      options: `-c search_path="${schema}"`,
    });
    await applyDurableKernelMigrations(poolA);
  });

  afterAll(async () => {
    await Promise.all([poolA?.end(), poolB?.end()]);
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  it('lets the succeeded-without-submit failure win without deadlock', async () => {
    const fixture = await seedFixture(poolA!, 'succeeded');
    const repoA = new PostgresTeamExecutionRepository(poolA!);
    const repoB = new PostgresTeamExecutionRepository(poolB!);

    const outcomes = await timeout(
      Promise.allSettled([
        repoA.submitCurrentAttempt({
          teamRunId: fixture.teamRunId,
          executionTaskId: fixture.childTaskId,
          currentRunId: fixture.childRunId,
          memberId: fixture.memberId,
          resultSummary: 'canonical result',
          owner: fixture.owner,
        }),
        repoB.failTeamRunAtomically(failureInput(fixture)),
      ]),
      10_000,
    );

    const fulfilled = outcomes.filter(
      (outcome) => outcome.status === 'fulfilled',
    );
    const rejected = outcomes.filter(
      (outcome) => outcome.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(fulfilled[0]!.value).toMatchObject({ status: 'failed' });
    expect(rejected[0]!.reason).toBeInstanceOf(TeamExecutionError);
    expect((rejected[0]!.reason as TeamExecutionError).code).toBe(
      'invalid_transition',
    );

    const state = await poolA!.query<{
      attempt_status: string;
      team_status: string;
      stop_reason: string | null;
      root_task_status: string;
      root_run_status: string;
      failure_events: number;
    }>(
      `SELECT a.status AS attempt_status, team.status AS team_status,
              team.stop_reason, task.status AS root_task_status,
              root_run.status AS root_run_status,
              (SELECT count(*)::int FROM run_events WHERE run_id=root_run.id AND type='failed') AS failure_events
         FROM team_work_item_attempts a
         JOIN team_runs team ON team.id=a.team_run_id
         JOIN tasks task ON task.id=team.root_task_id
         JOIN runs root_run ON root_run.id=team.root_run_id
        WHERE a.id=$1`,
      [fixture.attemptId],
    );
    expect(state.rows).toEqual([
      {
        attempt_status: 'failed',
        team_status: 'failed',
        stop_reason: 'succeeded_without_submit',
        root_task_status: 'failed',
        root_run_status: 'failed',
        failure_events: 1,
      },
    ]);
  });

  it('preserves the active Team when canonical submit wins', async () => {
    const fixture = await seedFixture(poolA!, 'running');
    const repoA = new PostgresTeamExecutionRepository(poolA!);
    const repoB = new PostgresTeamExecutionRepository(poolB!);

    const submitted = await repoA.submitCurrentAttempt({
      teamRunId: fixture.teamRunId,
      executionTaskId: fixture.childTaskId,
      currentRunId: fixture.childRunId,
      memberId: fixture.memberId,
      resultSummary: 'canonical result',
      owner: fixture.owner,
    });
    expect(submitted.status).toBe('completed');

    await poolA!.query(
      `UPDATE runs
          SET status='succeeded', lease_owner=NULL, activation_id=NULL,
              lease_expires_at=NULL, result='{"text":"provider done"}'::jsonb,
              error=NULL, updated_at=$2
        WHERE id=$1`,
      [fixture.childRunId, '2026-08-11T00:06:00.000Z'],
    );

    const failed = await repoB.failTeamRunAtomically(failureInput(fixture));
    expect(failed.status).toBe('active');
    expect(failed.stopReason).toBeNull();

    const state = await poolA!.query<{
      attempt_status: string;
      team_status: string;
      stop_reason: string | null;
      root_task_status: string;
      root_run_status: string;
      failure_events: number;
    }>(
      `SELECT a.status AS attempt_status, team.status AS team_status,
              team.stop_reason, task.status AS root_task_status,
              root_run.status AS root_run_status,
              (SELECT count(*)::int FROM run_events WHERE run_id=root_run.id AND type='failed') AS failure_events
         FROM team_work_item_attempts a
         JOIN team_runs team ON team.id=a.team_run_id
         JOIN tasks task ON task.id=team.root_task_id
         JOIN runs root_run ON root_run.id=team.root_run_id
        WHERE a.id=$1`,
      [fixture.attemptId],
    );
    expect(state.rows).toEqual([
      {
        attempt_status: 'completed',
        team_status: 'active',
        stop_reason: null,
        root_task_status: 'active',
        root_run_status: 'waiting_children',
        failure_events: 0,
      },
    ]);
  });
});
