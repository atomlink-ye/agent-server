import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

import type { TeamRun } from '../../src/domain/teams/team-run.js';
import type { TeamCompletionDecision } from '../../src/domain/teams/team-completion-decision.js';
import { PostgresAdmissionRepository } from '../../src/infrastructure/postgres/postgres-admission-repository.js';
import {
  applyDurableKernelMigrations,
  durableKernelMigrationFilePaths,
} from '../../src/infrastructure/postgres/postgres.js';
import { PostgresTeamExecutionRepository } from '../../src/infrastructure/postgres/postgres-collaborative-team-repository.js';

const owner = {
  tenantId: 'tenant_alpha',
  workspaceId: 'workspace_main',
  principalType: 'service_account',
  principalId: 'svc_alpha',
} as const;

const ids = {
  teamRun: '00000000-0000-4000-8000-000000009101',
  foreignTeamRun: '00000000-0000-4000-8000-000000009102',
  rootTask: '00000000-0000-4000-8000-000000009103',
  rootRun: '00000000-0000-4000-8000-000000009104',
  completionRequestRun: '00000000-0000-4000-8000-000000009107',
  leadTask: '00000000-0000-4000-8000-000000009108',
  leadMember: '00000000-0000-4000-8000-000000009114',
  activeLeadMember: '00000000-0000-4000-8000-000000009109',
  activeLeadTask: '00000000-0000-4000-8000-000000009110',
  activeLeadRun: '00000000-0000-4000-8000-000000009115',
  member: '00000000-0000-4000-8000-000000009105',
  foreignMember: '00000000-0000-4000-8000-000000009106',
  workItemA: '00000000-0000-4000-8000-000000009111',
  workItemB: '00000000-0000-4000-8000-000000009112',
  foreignWorkItem: '00000000-0000-4000-8000-000000009113',
  attemptA1: '00000000-0000-4000-8000-000000009121',
  attemptA2: '00000000-0000-4000-8000-000000009122',
  attemptB1: '00000000-0000-4000-8000-000000009123',
  foreignAttempt: '00000000-0000-4000-8000-000000009124',
} as const;

type CompletionApprovalRepository = PostgresTeamExecutionRepository & {
  findCompletionDecisionsByTeamRunId(
    teamRunId: string,
    owner: {
      tenantId: string;
      workspaceId: string;
      principalType: string;
      principalId: string;
    },
  ): Promise<readonly TeamCompletionDecision[]>;
  findLatestCompletionDecision(
    teamRunId: string,
    owner: {
      tenantId: string;
      workspaceId: string;
      principalType: string;
      principalId: string;
    },
  ): Promise<TeamCompletionDecision | null>;
};

type RejectionInput = {
  readonly teamRunId: string;
  readonly completionRequestedByRunId: string;
  readonly feedback: string;
  readonly workItemIds: readonly string[];
  readonly decidedBy: string;
  readonly decidedAt: string;
  readonly expectedRevision: number;
  readonly owner: typeof owner;
};

async function createDatabase(): Promise<PGlite> {
  const database = new PGlite();
  await applyDurableKernelMigrations(database);
  return database;
}

async function seedCompletionApprovalFixture(database: PGlite): Promise<void> {
  const timestamp = '2026-08-08T00:00:00.000Z';
  await database.query(
    `INSERT INTO tasks(
      id,root_task_id,parent_task_id,parent_run_id,depth,status,ingress,
      invokable_kind,invokable_version_id,input_snapshot_ref,input_fingerprint,
      created_at,updated_at,tenant_id,workspace_id,principal_type,principal_id,
      policy_snapshot_version
    ) VALUES ($1,$1,NULL,NULL,0,'completed','api','team',$2,'snapshot',$3,$4,$4,$5,$6,$7,$8,$9)`,
    [
      ids.rootTask,
      '00000000-0000-4000-8000-000000009130',
      'completion-approval-fixture',
      timestamp,
      owner.tenantId,
      owner.workspaceId,
      owner.principalType,
      owner.principalId,
      'policy-fixture',
    ],
  );

  await database.query(
    `INSERT INTO runs(
      id,task_id,attempt,status,fencing_token,result,created_at,updated_at
    ) VALUES ($1::uuid,$2::uuid,1,'succeeded',1,$3::jsonb,$4::timestamptz,$4::timestamptz)`,
    [ids.rootRun, ids.rootTask, '{"text":"root"}', timestamp],
  );

  await database.query(
    `INSERT INTO tasks(
      id,root_task_id,parent_task_id,parent_run_id,depth,status,ingress,
      invokable_kind,invokable_version_id,input_snapshot_ref,input_fingerprint,
      created_at,updated_at,tenant_id,workspace_id,principal_type,principal_id,
      policy_snapshot_version,logical_step_key,node_path,team_task_kind
    ) VALUES ($1::uuid,$2::uuid,$2::uuid,$3::uuid,1,'completed','api','agent',$4::text,'snapshot',$5::text,$6::timestamptz,$6::timestamptz,$7::text,$8::text,$9::text,$10::text,$11::text,'lead-turn','lead','lead_turn')`,
    [
      ids.leadTask,
      ids.rootTask,
      ids.rootRun,
      '00000000-0000-4000-8000-000000009130',
      'lead-task-fixture',
      timestamp,
      owner.tenantId,
      owner.workspaceId,
      owner.principalType,
      owner.principalId,
      'policy-fixture',
    ],
  );

  await database.query(
    `INSERT INTO runs(
      id,task_id,attempt,status,fencing_token,result,created_at,updated_at
    ) VALUES ($1::uuid,$2::uuid,1,'succeeded',1,$3::jsonb,$4::timestamptz,$4::timestamptz)`,
    [ids.completionRequestRun, ids.leadTask, '{"text":"request"}', timestamp],
  );

  await database.query(
    `INSERT INTO team_runs(
      id,tenant_id,workspace_id,principal_type,principal_id,root_task_id,
      root_run_id,team_version_id,environment_version_id,status,phase,final_text,
      control_state,revision,lead_turn_count,stop_reason,
      completion_requested_by_run_id,completion_approval_required,created_at,updated_at
    ) VALUES
      ($1::uuid,$3::text,$4::text,$5::text,$6::text,$7::uuid,$8::uuid,$9::uuid,$10::uuid,'active','lead_finalize',NULL,'lead_running',7,4,NULL,$16::uuid,true,$15::timestamptz,$15::timestamptz),
      ($2::uuid,$3::text,$4::text,$5::text,$6::text,$11::uuid,$12::uuid,$13::uuid,$14::uuid,'active','member_work',NULL,'member_work_running',2,1,NULL,NULL,true,$15::timestamptz,$15::timestamptz)`,
    [
      ids.teamRun,
      ids.foreignTeamRun,
      owner.tenantId,
      owner.workspaceId,
      owner.principalType,
      owner.principalId,
      ids.rootTask,
      ids.rootRun,
      '00000000-0000-4000-8000-000000009131',
      '00000000-0000-4000-8000-000000009132',
      '00000000-0000-4000-8000-000000009133',
      '00000000-0000-4000-8000-000000009134',
      '00000000-0000-4000-8000-000000009135',
      '00000000-0000-4000-8000-000000009136',
      timestamp,
      ids.completionRequestRun,
    ],
  );

  await database.query(
    `INSERT INTO team_member_runs(
      id,team_run_id,name,role,worker_version_id,status,tenant_id,workspace_id,
      principal_type,principal_id,created_at,updated_at
    ) VALUES
      ($1::uuid,$3::uuid,'reviewer','member',$5::uuid,'active',$7::text,$8::text,$9::text,$10::text,$11::timestamptz,$11::timestamptz),
      ($2::uuid,$4::uuid,'foreign-reviewer','member',$6::uuid,'active',$7::text,$8::text,$9::text,$10::text,$11::timestamptz,$11::timestamptz)`,
    [
      ids.member,
      ids.foreignMember,
      ids.teamRun,
      ids.foreignTeamRun,
      '00000000-0000-4000-8000-000000009141',
      '00000000-0000-4000-8000-000000009142',
      owner.tenantId,
      owner.workspaceId,
      owner.principalType,
      owner.principalId,
      timestamp,
    ],
  );

  await database.query(
    `INSERT INTO team_member_runs(
      id,team_run_id,name,role,worker_version_id,status,tenant_id,workspace_id,
      principal_type,principal_id,created_at,updated_at
    ) VALUES ($1,$2,'fixture-lead','lead',$3,'active',$4,$5,$6,$7,$8,$8)`,
    [
      ids.leadMember,
      ids.teamRun,
      '00000000-0000-4000-8000-000000009140',
      owner.tenantId,
      owner.workspaceId,
      owner.principalType,
      owner.principalId,
      timestamp,
    ],
  );
  await database.query(`UPDATE tasks SET team_member_run_id=$2 WHERE id=$1`, [
    ids.leadTask,
    ids.leadMember,
  ]);

  await database.query(
    `INSERT INTO team_work_items(
      id,team_run_id,subject,description,status,owner_member_id,created_by_member_id,
      completion_summary,execution_task_id,tenant_id,workspace_id,principal_type,
      principal_id,created_at,updated_at,completed_at
    ) VALUES
      ($1::uuid,$4::uuid,'API contract','contract work','accepted',$6::uuid,$6::uuid,'done',NULL,$8::text,$9::text,$10::text,$11::text,$12::timestamptz,$12::timestamptz,$12::timestamptz),
      ($2::uuid,$4::uuid,'UI copy','copy work','accepted',$6::uuid,$6::uuid,'done',NULL,$8::text,$9::text,$10::text,$11::text,$12::timestamptz,$12::timestamptz,$12::timestamptz),
      ($3::uuid,$5::uuid,'foreign item','foreign work','accepted',$7::uuid,$7::uuid,'done',NULL,$8::text,$9::text,$10::text,$11::text,$12::timestamptz,$12::timestamptz,$12::timestamptz)`,
    [
      ids.workItemA,
      ids.workItemB,
      ids.foreignWorkItem,
      ids.teamRun,
      ids.foreignTeamRun,
      ids.member,
      ids.foreignMember,
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
    ) VALUES
      ($1::uuid,$5::uuid,$8::uuid,1,$10::uuid,$11::uuid,NULL,NULL,'completed','first pass',$13::text,$14::text,$15::text,$16::text,$17::timestamptz,$17::timestamptz,$17::timestamptz),
      ($2::uuid,$5::uuid,$8::uuid,2,$10::uuid,$11::uuid,'revise once',NULL,'completed','final pass',$13::text,$14::text,$15::text,$16::text,$17::timestamptz,$17::timestamptz,$17::timestamptz),
      ($3::uuid,$6::uuid,$8::uuid,1,$10::uuid,$11::uuid,NULL,NULL,'completed','copy pass',$13::text,$14::text,$15::text,$16::text,$17::timestamptz,$17::timestamptz,$17::timestamptz),
      ($4::uuid,$7::uuid,$9::uuid,1,$12::uuid,$11::uuid,NULL,NULL,'completed','foreign pass',$13::text,$14::text,$15::text,$16::text,$17::timestamptz,$17::timestamptz,$17::timestamptz)`,
    [
      ids.attemptA1,
      ids.attemptA2,
      ids.attemptB1,
      ids.foreignAttempt,
      ids.workItemA,
      ids.workItemB,
      ids.foreignWorkItem,
      ids.teamRun,
      ids.foreignTeamRun,
      ids.member,
      ids.leadTask,
      ids.foreignMember,
      owner.tenantId,
      owner.workspaceId,
      owner.principalType,
      owner.principalId,
      timestamp,
    ],
  );
}

async function seededRepository(): Promise<{
  database: PGlite;
  repository: CompletionApprovalRepository;
}> {
  const database = await createDatabase();
  await seedCompletionApprovalFixture(database);
  return {
    database,
    repository: new PostgresTeamExecutionRepository(
      database,
    ) as CompletionApprovalRepository,
  };
}

async function recordRejection(
  database: PGlite,
  input: RejectionInput,
): Promise<{
  decision: TeamCompletionDecision;
  team: TeamRun;
  recorded: boolean;
}> {
  return new PostgresAdmissionRepository(database).withTransaction(async (tx) =>
    tx.teamExecutions!.recordCompletionRejectionInTransaction(input),
  );
}

async function seedActiveLeadSource(database: PGlite): Promise<void> {
  const timestamp = '2026-08-08T00:00:00.000Z';
  await database.query(
    `INSERT INTO team_member_runs(
      id,team_run_id,name,role,worker_version_id,status,tenant_id,workspace_id,
      principal_type,principal_id,created_at,updated_at
    ) VALUES ($1,$2,'active-lead','lead',$3,'active',$4,$5,$6,$7,$8,$8)`,
    [
      ids.activeLeadMember,
      ids.teamRun,
      '00000000-0000-4000-8000-000000009143',
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
      policy_snapshot_version,logical_step_key,node_path,team_task_kind,team_member_run_id
    ) VALUES ($1,$2,$2,$3,1,'active','api','agent',$4,'snapshot',$5,$6,$6,$7,$8,$9,$10,$11,'active-lead','lead','lead_turn',$12)`,
    [
      ids.activeLeadTask,
      ids.rootTask,
      ids.rootRun,
      '00000000-0000-4000-8000-000000009130',
      'active-lead-task-fixture',
      timestamp,
      owner.tenantId,
      owner.workspaceId,
      owner.principalType,
      owner.principalId,
      'policy-fixture',
      ids.activeLeadMember,
    ],
  );
  await database.query(
    `INSERT INTO runs(
      id,task_id,attempt,status,lease_owner,activation_id,fencing_token,
      lease_expires_at,result,error,created_at,updated_at
    ) VALUES ($1,$2,1,'running','active-lead',$3,1,$4,NULL,NULL,$5,$5)`,
    [
      ids.activeLeadRun,
      ids.activeLeadTask,
      '00000000-0000-4000-8000-000000009116',
      '2026-08-08T01:00:00.000Z',
      timestamp,
    ],
  );
}

describe('Postgres team completion approval persistence (PGlite)', () => {
  it('atomically records a rejection with attempt snapshots and preserves team state', async () => {
    const { database, repository } = await seededRepository();
    const result = await recordRejection(database, {
      teamRunId: ids.teamRun,
      completionRequestedByRunId: ids.completionRequestRun,
      feedback: 'Please address the API contract and copy.',
      workItemIds: [ids.workItemA, ids.workItemB],
      decidedBy: 'svc_reviewer',
      decidedAt: '2026-08-08T00:05:00.000Z',
      expectedRevision: 7,
      owner,
    });

    expect(result.decision).toMatchObject({
      teamRunId: ids.teamRun,
      completionRequestedByRunId: ids.completionRequestRun,
      decision: 'reject',
      feedback: 'Please address the API contract and copy.',
      decidedBy: 'svc_reviewer',
      decidedAt: '2026-08-08T00:05:00.000Z',
      targets: [
        { workItemId: ids.workItemA, attemptNoAtDecision: 2 },
        { workItemId: ids.workItemB, attemptNoAtDecision: 1 },
      ],
    });
    expect(result.team).toMatchObject({
      id: ids.teamRun,
      status: 'active',
      controlState: 'lead_running',
      completionRequestedByRunId: ids.completionRequestRun,
      revision: 8,
    });

    const raw = await database.query<{
      status: string;
      control_state: string;
      completion_requested_by_run_id: string;
      revision: number;
    }>(
      `SELECT status,control_state,completion_requested_by_run_id,revision
         FROM team_runs WHERE id=$1`,
      [ids.teamRun],
    );
    expect(raw.rows).toEqual([
      {
        status: 'active',
        control_state: 'lead_running',
        completion_requested_by_run_id: ids.completionRequestRun,
        revision: 8,
      },
    ]);

    const decisions = await repository.findCompletionDecisionsByTeamRunId(
      ids.teamRun,
      owner,
    );
    const latest = await repository.findLatestCompletionDecision(
      ids.teamRun,
      owner,
    );
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toEqual(result.decision);
    expect(latest).toEqual(result.decision);
    expect(Object.isFrozen(decisions)).toBe(true);
    expect(Object.isFrozen(decisions[0])).toBe(true);
    expect(Object.isFrozen(decisions[0]!.targets)).toBe(true);
  });

  it('replays only an exact normalized rejection payload', async () => {
    const { database, repository } = await seededRepository();
    const first = await recordRejection(database, {
      teamRunId: ids.teamRun,
      completionRequestedByRunId: ids.completionRequestRun,
      feedback: 'Please address the API contract and copy.',
      workItemIds: [ids.workItemA, ids.workItemB],
      decidedBy: 'svc_reviewer',
      decidedAt: '2026-08-08T00:05:00.000Z',
      expectedRevision: 7,
      owner,
    });
    expect(first.recorded).toBe(true);
    const replay = await recordRejection(database, {
      teamRunId: ids.teamRun,
      completionRequestedByRunId: ids.completionRequestRun,
      feedback: '  Please address the API contract and copy.  ',
      workItemIds: [ids.workItemA, ids.workItemB],
      decidedBy: 'svc_reviewer',
      decidedAt: '2026-08-08T01:05:00.000Z',
      expectedRevision: 7,
      owner,
    });
    expect(replay.decision).toEqual(first.decision);
    expect(replay.recorded).toBe(false);
    await expect(
      recordRejection(database, {
        teamRunId: ids.teamRun,
        completionRequestedByRunId: ids.completionRequestRun,
        feedback: 'Please address the API contract and copy.',
        workItemIds: [ids.workItemA, ids.workItemB],
        decidedBy: 'svc_reviewer',
        decidedAt: '2026-08-08T01:05:00.000Z',
        expectedRevision: 6,
        owner,
      }),
    ).rejects.toMatchObject({ code: 'stale_state' });
    await expect(
      recordRejection(database, {
        teamRunId: ids.teamRun,
        completionRequestedByRunId: ids.completionRequestRun,
        feedback: 'Different feedback',
        workItemIds: [ids.workItemA, ids.workItemB],
        decidedBy: 'svc_reviewer',
        decidedAt: '2026-08-08T01:05:00.000Z',
        expectedRevision: 7,
        owner,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      recordRejection(database, {
        teamRunId: ids.teamRun,
        completionRequestedByRunId: ids.completionRequestRun,
        feedback: 'Please address the API contract and copy.',
        workItemIds: [ids.workItemB, ids.workItemA],
        decidedBy: 'svc_reviewer',
        decidedAt: '2026-08-08T01:05:00.000Z',
        expectedRevision: 7,
        owner,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it.each([
    ['missing target', ['00000000-0000-4000-8000-000000009199']],
    ['target from another TeamRun', [ids.foreignWorkItem]],
  ])('rejects %s with invalid_target', async (_label, workItemIds) => {
    const { database, repository } = await seededRepository();

    await expect(
      recordRejection(database, {
        teamRunId: ids.teamRun,
        completionRequestedByRunId: ids.completionRequestRun,
        feedback: 'Please revise the target.',
        workItemIds,
        decidedBy: 'svc_reviewer',
        decidedAt: '2026-08-08T00:05:00.000Z',
        expectedRevision: 7,
        owner,
      }),
    ).rejects.toMatchObject({ code: 'invalid_target' });
  });

  it('rejects a stale revision and leaves no completion decisions', async () => {
    const { database, repository } = await seededRepository();

    await expect(
      recordRejection(database, {
        teamRunId: ids.teamRun,
        completionRequestedByRunId: ids.completionRequestRun,
        feedback: 'Please revise the target.',
        workItemIds: [ids.workItemA],
        decidedBy: 'svc_reviewer',
        decidedAt: '2026-08-08T00:05:00.000Z',
        expectedRevision: 6,
        owner,
      }),
    ).rejects.toMatchObject({ code: 'stale_state' });

    await expect(
      repository.findCompletionDecisionsByTeamRunId(ids.teamRun, owner),
    ).resolves.toEqual([]);
  });

  it('allows one exact rejected attempt snapshot to consume the max-attempt boundary', async () => {
    const { database, repository } = await seededRepository();
    await recordRejection(database, {
      teamRunId: ids.teamRun,
      completionRequestedByRunId: ids.completionRequestRun,
      feedback: 'Please revise the target.',
      workItemIds: [ids.workItemA],
      decidedBy: 'svc_reviewer',
      decidedAt: '2026-08-08T00:05:00.000Z',
      expectedRevision: 7,
      owner,
    });
    await seedActiveLeadSource(database);

    const attempt = await repository.requestRework({
      teamRunId: ids.teamRun,
      workItemId: ids.workItemA,
      assigneeMemberId: ids.member,
      feedback: 'Address the rejected API contract.',
      sourceRunId: ids.activeLeadRun,
      leadTaskId: ids.activeLeadTask,
      commandHash: 'rework-after-rejection',
      expectedRevision: 8,
      owner,
    });

    expect(attempt.attemptNo).toBe(3);
    expect(attempt.status).toBe('queued');
    await expect(
      repository.findLatestCompletionDecision(ids.teamRun, owner),
    ).resolves.toMatchObject({
      decision: 'reject',
      targets: [{ workItemId: ids.workItemA, attemptNoAtDecision: 2 }],
    });
    await expect(
      repository.findWorkItemById(ids.workItemA, owner),
    ).resolves.toMatchObject({
      status: 'pending',
    });

    await database.query(
      `UPDATE team_work_item_attempts
          SET status='completed',result_summary='third pass',completed_at=$2,updated_at=$2
        WHERE work_item_id=$1 AND attempt_no=3`,
      [ids.workItemA, '2026-08-08T00:06:00.000Z'],
    );
    await database.query(
      `UPDATE team_work_items SET status='accepted',updated_at=$2 WHERE id=$1`,
      [ids.workItemA, '2026-08-08T00:06:00.000Z'],
    );
    await expect(
      repository.requestRework({
        teamRunId: ids.teamRun,
        workItemId: ids.workItemA,
        assigneeMemberId: ids.member,
        feedback: 'The snapshot must not be reusable.',
        sourceRunId: ids.activeLeadRun,
        leadTaskId: ids.activeLeadTask,
        commandHash: 'rework-after-newer-attempt',
        expectedRevision: 9,
        owner,
      }),
    ).rejects.toMatchObject({ code: 'invalid_transition' });
  });

  it('starts a fresh lead-turn epoch from the rejection baseline', async () => {
    const { database, repository } = await seededRepository();
    await database.query(`UPDATE team_runs SET lead_turn_count=8 WHERE id=$1`, [
      ids.teamRun,
    ]);
    await recordRejection(database, {
      teamRunId: ids.teamRun,
      completionRequestedByRunId: ids.completionRequestRun,
      feedback: 'Please revise the target.',
      workItemIds: [ids.workItemA],
      decidedBy: 'svc_reviewer',
      decidedAt: '2026-08-08T00:05:00.000Z',
      expectedRevision: 7,
      owner,
    });

    const next = await repository.advanceAgenticLead({
      teamRunId: ids.teamRun,
      expectedRevision: 8,
      owner,
    });

    expect(next.leadTurnCount).toBe(9);
    expect(next.revision).toBe(9);
  });

  it('keeps the absolute lead-turn cap without a matching rejection', async () => {
    const { database, repository } = await seededRepository();
    await database.query(`UPDATE team_runs SET lead_turn_count=8 WHERE id=$1`, [
      ids.teamRun,
    ]);

    await expect(
      repository.advanceAgenticLead({
        teamRunId: ids.teamRun,
        expectedRevision: 7,
        owner,
      }),
    ).rejects.toMatchObject({ code: 'limit_exceeded' });
  });

  it('rejects a corrupt rejection baseline ahead of the lead count', async () => {
    const { database, repository } = await seededRepository();
    await database.query(`UPDATE team_runs SET lead_turn_count=8 WHERE id=$1`, [
      ids.teamRun,
    ]);
    await expect(
      database.query(
        `INSERT INTO team_completion_decisions(
        id,team_run_id,completion_requested_by_run_id,decision,feedback,
        decided_by,decided_at,team_revision_at_decision,lead_turn_count_at_decision,
        tenant_id,workspace_id,principal_type,principal_id
      ) VALUES ($1,$2,$3,'reject','corrupt baseline','svc_reviewer',$4,7,12,$5,$6,$7,$8)`,
        [
          '00000000-0000-4000-8000-000000009151',
          ids.teamRun,
          ids.completionRequestRun,
          '2026-08-08T00:05:00.000Z',
          owner.tenantId,
          owner.workspaceId,
          owner.principalType,
          owner.principalId,
        ],
      ),
    ).rejects.toThrow(/completion request|Lead/i);
  });

  it('allows a rejected accepted attempt below the cap to re-enter rework', async () => {
    const { database, repository } = await seededRepository();
    await recordRejection(database, {
      teamRunId: ids.teamRun,
      completionRequestedByRunId: ids.completionRequestRun,
      feedback: 'Please revise the copy.',
      workItemIds: [ids.workItemB],
      decidedBy: 'svc_reviewer',
      decidedAt: '2026-08-08T00:05:00.000Z',
      expectedRevision: 7,
      owner,
    });
    await seedActiveLeadSource(database);

    const attempt = await repository.requestRework({
      teamRunId: ids.teamRun,
      workItemId: ids.workItemB,
      assigneeMemberId: ids.member,
      feedback: 'Address the copy feedback.',
      sourceRunId: ids.activeLeadRun,
      leadTaskId: ids.activeLeadTask,
      commandHash: 'rework-attempt-one-rejection',
      expectedRevision: 8,
      owner,
    });

    expect(attempt.attemptNo).toBe(2);
    await expect(
      repository.findWorkItemById(ids.workItemB, owner),
    ).resolves.toMatchObject({
      status: 'pending',
    });
  });

  it('persists approval and completes the Team/root atomically', async () => {
    const { database, repository } = await seededRepository();
    await database.query(
      `UPDATE runs SET status='waiting_children',result=NULL WHERE id=$1`,
      [ids.rootRun],
    );
    await database.query(`UPDATE tasks SET status='active' WHERE id=$1`, [
      ids.rootTask,
    ]);

    const team = await repository.completeTeamRunAtomically({
      teamRunId: ids.teamRun,
      rootRunId: ids.rootRun,
      rootTaskId: ids.rootTask,
      finalText: 'Approved final output',
      owner,
      updatedAt: '2026-08-08T00:10:00.000Z',
      leadRunId: ids.completionRequestRun,
      approvalDecision: {
        expectedRevision: 7,
        decidedBy: 'svc_reviewer',
        decidedAt: '2026-08-08T00:09:00.000Z',
      },
    });

    expect(team.status).toBe('succeeded');
    expect(team.revision).toBe(8);
    await expect(
      repository.completeTeamRunAtomically({
        teamRunId: ids.teamRun,
        rootRunId: ids.rootRun,
        rootTaskId: ids.rootTask,
        finalText: 'Approved final output',
        owner,
        updatedAt: '2026-08-08T00:10:30.000Z',
        leadRunId: ids.completionRequestRun,
        approvalDecision: {
          expectedRevision: 7,
          decidedBy: 'svc_reviewer',
          decidedAt: '2026-08-08T00:10:30.000Z',
        },
      }),
    ).resolves.toMatchObject({ status: 'succeeded', revision: 8 });
    await expect(
      repository.findCompletionDecisionForRequest(
        ids.teamRun,
        ids.completionRequestRun,
        owner,
      ),
    ).resolves.toMatchObject({
      decision: 'approve',
      teamRevisionAtDecision: 7,
      leadTurnCountAtDecision: 4,
      targets: [],
    });

    await expect(
      repository.completeTeamRunAtomically({
        teamRunId: ids.teamRun,
        rootRunId: ids.rootRun,
        rootTaskId: ids.rootTask,
        finalText: 'Approved final output',
        owner,
        updatedAt: '2026-08-08T00:11:00.000Z',
        leadRunId: ids.completionRequestRun,
        approvalDecision: {
          expectedRevision: 7,
          decidedBy: 'different-reviewer',
          decidedAt: '2026-08-08T00:11:00.000Z',
        },
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      repository.completeTeamRunAtomically({
        teamRunId: ids.teamRun,
        rootRunId: ids.rootRun,
        rootTaskId: ids.rootTask,
        finalText: 'Approved final output',
        owner,
        updatedAt: '2026-08-08T00:11:00.000Z',
        leadRunId: ids.completionRequestRun,
        approvalDecision: {
          expectedRevision: 6,
          decidedBy: 'svc_reviewer',
          decidedAt: '2026-08-08T00:11:00.000Z',
        },
      }),
    ).rejects.toMatchObject({ code: 'stale_state' });
  });

  it('increments revision exactly once when completing with approval disabled', async () => {
    const { database, repository } = await seededRepository();
    await database.query(
      `UPDATE team_runs SET completion_approval_required=false WHERE id=$1`,
      [ids.teamRun],
    );
    await database.query(
      `UPDATE runs SET status='waiting_children',result=NULL WHERE id=$1`,
      [ids.rootRun],
    );
    await database.query(`UPDATE tasks SET status='active' WHERE id=$1`, [
      ids.rootTask,
    ]);

    const before = await database.query<{ revision: number }>(
      `SELECT revision FROM team_runs WHERE id=$1`,
      [ids.teamRun],
    );
    const team = await repository.completeTeamRunAtomically({
      teamRunId: ids.teamRun,
      rootRunId: ids.rootRun,
      rootTaskId: ids.rootTask,
      finalText: 'Ungated final output',
      owner,
      updatedAt: '2026-08-08T00:10:00.000Z',
      leadRunId: ids.completionRequestRun,
    });

    expect(team.revision).toBe(before.rows![0]!.revision + 1);
    const after = await database.query<{ revision: number }>(
      `SELECT revision FROM team_runs WHERE id=$1`,
      [ids.teamRun],
    );
    expect(after.rows).toEqual([{ revision: before.rows![0]!.revision + 1 }]);
  });

  it('rolls back approval and Team completion when root completion fails', async () => {
    const { database, repository } = await seededRepository();
    await expect(
      repository.completeTeamRunAtomically({
        teamRunId: ids.teamRun,
        rootRunId: ids.rootRun,
        rootTaskId: ids.rootTask,
        finalText: 'This must roll back',
        owner,
        updatedAt: '2026-08-08T00:10:00.000Z',
        leadRunId: ids.completionRequestRun,
        approvalDecision: {
          expectedRevision: 7,
          decidedBy: 'svc_reviewer',
          decidedAt: '2026-08-08T00:09:00.000Z',
        },
      }),
    ).rejects.toThrow('Root run was not waiting');
    await expect(
      repository.findCompletionDecisionForRequest(
        ids.teamRun,
        ids.completionRequestRun,
        owner,
      ),
    ).resolves.toBeNull();
    await expect(
      repository.findTeamRunById(ids.teamRun, owner),
    ).resolves.toMatchObject({
      status: 'active',
      revision: 7,
    });
  });
});
