import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

import { applyDurableKernelMigrations } from '../../src/infrastructure/postgres/postgres.js';
import { PostgresSessionTranscriptFactsQuery } from '../../src/infrastructure/postgres/postgres-session-transcript-facts-query.js';

interface Owner {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
}

const ownerA: Owner = {
  tenantId: 'tenant_alpha',
  workspaceId: 'workspace_alpha',
  principalType: 'service_account',
  principalId: 'svc_alpha',
};

const ownerB: Owner = {
  tenantId: 'tenant_beta',
  workspaceId: 'workspace_beta',
  principalType: 'service_account',
  principalId: 'svc_beta',
};

const ids = {
  soloAgentDefinition: '00000000-0000-4000-8000-000000009301',
  soloAgentVersion: '00000000-0000-4000-8000-000000009302',
  soloRootTask: '00000000-0000-4000-8000-000000009303',
  soloRun: '00000000-0000-4000-8000-000000009304',

  teamRootTask: '00000000-0000-4000-8000-000000009310',
  teamRootRun: '00000000-0000-4000-8000-000000009311',
  teamRun: '00000000-0000-4000-8000-000000009312',
  teamVersion: '00000000-0000-4000-8000-000000009313',
  environmentVersion: '00000000-0000-4000-8000-000000009314',

  leadAgentDefinition: '00000000-0000-4000-8000-000000009319',
  leadAgentVersion: '00000000-0000-4000-8000-000000009323',
  leadMember: '00000000-0000-4000-8000-000000009320',
  leadTask: '00000000-0000-4000-8000-000000009321',
  leadRun: '00000000-0000-4000-8000-000000009322',

  workerAgentDefinition: '00000000-0000-4000-8000-000000009329',
  workerAgentVersion: '00000000-0000-4000-8000-000000009333',
  workerMember: '00000000-0000-4000-8000-000000009330',
  workerTask: '00000000-0000-4000-8000-000000009331',
  workerRun: '00000000-0000-4000-8000-000000009332',

  startingMember: '00000000-0000-4000-8000-000000009340',

  foreignTaskLeak: '00000000-0000-4000-8000-000000009350',
  foreignRunLeak: '00000000-0000-4000-8000-000000009351',
  foreignMemberLeak: '00000000-0000-4000-8000-000000009352',
} as const;

const timestamp = '2026-08-20T00:00:00.000Z';

async function createDatabase(): Promise<PGlite> {
  const database = new PGlite();
  await applyDurableKernelMigrations(database);
  return database;
}

async function seedAgentVersion(
  database: PGlite,
  input: {
    readonly definitionId: string;
    readonly versionId: string;
    readonly name: string;
    readonly owner: Owner;
  },
): Promise<void> {
  await database.query(
    `INSERT INTO agent_definitions(
      id,tenant_id,workspace_id,principal_type,principal_id,name,description,
      created_at,updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$7)`,
    [
      input.definitionId,
      input.owner.tenantId,
      input.owner.workspaceId,
      input.owner.principalType,
      input.owner.principalId,
      `${input.name} definition`,
      timestamp,
    ],
  );
  await database.query(
    `INSERT INTO agent_versions(
      id,definition_id,tenant_id,workspace_id,principal_type,principal_id,status,
      name,description,instructions,created_at,updated_at,published_at
    ) VALUES ($1,$2,$3,$4,$5,$6,'published',$7,NULL,'fixture instructions',$8,$8,$8)`,
    [
      input.versionId,
      input.definitionId,
      input.owner.tenantId,
      input.owner.workspaceId,
      input.owner.principalType,
      input.owner.principalId,
      input.name,
      timestamp,
    ],
  );
}

async function insertRootTask(
  database: PGlite,
  input: {
    readonly id: string;
    readonly invokableKind: 'agent' | 'team';
    readonly invokableVersionId: string;
    readonly owner: Owner;
  },
): Promise<void> {
  await database.query(
    `INSERT INTO tasks(
      id,root_task_id,parent_task_id,parent_run_id,depth,status,ingress,
      invokable_kind,invokable_version_id,input_snapshot_ref,input_fingerprint,
      created_at,updated_at,tenant_id,workspace_id,principal_type,principal_id,
      policy_snapshot_version
    ) VALUES ($1,$1,NULL,NULL,0,'active','api',$2,$3,'snapshot','fingerprint',
      $4,$4,$5,$6,$7,$8,'policy-fixture')`,
    [
      input.id,
      input.invokableKind,
      input.invokableVersionId,
      timestamp,
      input.owner.tenantId,
      input.owner.workspaceId,
      input.owner.principalType,
      input.owner.principalId,
    ],
  );
}

async function insertChildTask(
  database: PGlite,
  input: {
    readonly id: string;
    readonly rootTaskId: string;
    readonly parentTaskId: string;
    readonly parentRunId: string;
    readonly invokableVersionId: string;
    readonly teamMemberRunId: string | null;
    readonly owner: Owner;
  },
): Promise<void> {
  await database.query(
    `INSERT INTO tasks(
      id,root_task_id,parent_task_id,parent_run_id,depth,status,ingress,
      invokable_kind,invokable_version_id,input_snapshot_ref,input_fingerprint,
      created_at,updated_at,tenant_id,workspace_id,principal_type,principal_id,
      policy_snapshot_version,logical_step_key,node_path,team_task_kind,
      team_member_run_id
    ) VALUES ($1,$2,$3,$4,1,'active','api','agent',$5,'snapshot','fingerprint',
      $6,$6,$7,$8,$9,$10,'policy-fixture',$11,$11,'work_attempt',$12)`,
    [
      input.id,
      input.rootTaskId,
      input.parentTaskId,
      input.parentRunId,
      input.invokableVersionId,
      timestamp,
      input.owner.tenantId,
      input.owner.workspaceId,
      input.owner.principalType,
      input.owner.principalId,
      // Unique per Task (tasks_root_logical_step_key_unique is scoped to
      // (root_task_id, logical_step_key)), distinct from the Task's own id.
      `step-${input.id}`,
      input.teamMemberRunId,
    ],
  );
}

async function insertSucceededRun(
  database: PGlite,
  input: {
    readonly id: string;
    readonly taskId: string;
    readonly provider?: string;
    readonly model?: string;
  },
): Promise<void> {
  await database.query(
    `INSERT INTO runs(
      id,task_id,attempt,status,fencing_token,runtime,result,created_at,updated_at
    ) VALUES ($1,$2,1,'succeeded',1,$3::jsonb,$4::jsonb,$5,$5)`,
    [
      input.id,
      input.taskId,
      JSON.stringify({ provider: input.provider ?? null, model: input.model ?? null }),
      JSON.stringify({ text: 'done' }),
      timestamp,
    ],
  );
}

async function insertRunningRun(
  database: PGlite,
  input: { readonly id: string; readonly taskId: string },
): Promise<void> {
  await database.query(
    `INSERT INTO runs(
      id,task_id,attempt,status,lease_owner,activation_id,fencing_token,
      lease_expires_at,created_at,updated_at
    ) VALUES ($1,$2,1,'running','worker','00000000-0000-4000-8000-000000009360',1,
      $3,$4,$4)`,
    [input.id, input.taskId, '2026-08-20T01:00:00.000Z', timestamp],
  );
}

async function insertTeamRun(database: PGlite): Promise<void> {
  await database.query(
    `INSERT INTO team_runs(
      id,tenant_id,workspace_id,principal_type,principal_id,root_task_id,
      root_run_id,team_version_id,environment_version_id,status,phase,
      final_text,created_at,updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active','member_work',NULL,$10,$10)`,
    [
      ids.teamRun,
      ownerA.tenantId,
      ownerA.workspaceId,
      ownerA.principalType,
      ownerA.principalId,
      ids.teamRootTask,
      ids.teamRootRun,
      ids.teamVersion,
      ids.environmentVersion,
      timestamp,
    ],
  );
}

async function insertTeamMember(
  database: PGlite,
  input: {
    readonly id: string;
    readonly teamRunId: string;
    readonly name: string;
    readonly role: 'lead' | 'member';
    readonly agentVersionId: string;
    readonly status: string;
    readonly owner: Owner;
  },
): Promise<void> {
  await database.query(
    `INSERT INTO team_member_runs(
      id,team_run_id,name,role,agent_version_id,status,tenant_id,workspace_id,
      principal_type,principal_id,created_at,updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
    [
      input.id,
      input.teamRunId,
      input.name,
      input.role,
      input.agentVersionId,
      input.status,
      input.owner.tenantId,
      input.owner.workspaceId,
      input.owner.principalType,
      input.owner.principalId,
      timestamp,
    ],
  );
}

async function seedSoloAgentFixture(database: PGlite): Promise<void> {
  await seedAgentVersion(database, {
    definitionId: ids.soloAgentDefinition,
    versionId: ids.soloAgentVersion,
    name: 'Solo Agent',
    owner: ownerA,
  });
  await insertRootTask(database, {
    id: ids.soloRootTask,
    invokableKind: 'agent',
    invokableVersionId: ids.soloAgentVersion,
    owner: ownerA,
  });
  await insertSucceededRun(database, {
    id: ids.soloRun,
    taskId: ids.soloRootTask,
    provider: 'paseo',
    model: 'free-model',
  });
}

async function seedTeamFixture(database: PGlite): Promise<void> {
  await seedAgentVersion(database, {
    definitionId: ids.leadAgentDefinition,
    versionId: ids.leadAgentVersion,
    name: 'Lead Agent',
    owner: ownerA,
  });
  await seedAgentVersion(database, {
    definitionId: ids.workerAgentDefinition,
    versionId: ids.workerAgentVersion,
    name: 'Worker Agent',
    owner: ownerA,
  });

  await insertRootTask(database, {
    id: ids.teamRootTask,
    invokableKind: 'team',
    invokableVersionId: 'team-invokable-fixture',
    owner: ownerA,
  });
  await insertSucceededRun(database, {
    id: ids.teamRootRun,
    taskId: ids.teamRootTask,
  });
  await insertTeamRun(database);

  await insertTeamMember(database, {
    id: ids.leadMember,
    teamRunId: ids.teamRun,
    name: 'lead',
    role: 'lead',
    agentVersionId: ids.leadAgentVersion,
    status: 'active',
    owner: ownerA,
  });
  await insertChildTask(database, {
    id: ids.leadTask,
    rootTaskId: ids.teamRootTask,
    parentTaskId: ids.teamRootTask,
    parentRunId: ids.teamRootRun,
    invokableVersionId: ids.leadAgentVersion,
    teamMemberRunId: ids.leadMember,
    owner: ownerA,
  });
  await insertSucceededRun(database, { id: ids.leadRun, taskId: ids.leadTask });

  await insertTeamMember(database, {
    id: ids.workerMember,
    teamRunId: ids.teamRun,
    name: 'worker',
    role: 'member',
    agentVersionId: ids.workerAgentVersion,
    status: 'idle',
    owner: ownerA,
  });
  await insertChildTask(database, {
    id: ids.workerTask,
    rootTaskId: ids.teamRootTask,
    parentTaskId: ids.teamRootTask,
    parentRunId: ids.teamRootRun,
    invokableVersionId: ids.workerAgentVersion,
    teamMemberRunId: ids.workerMember,
    owner: ownerA,
  });
  await insertRunningRun(database, { id: ids.workerRun, taskId: ids.workerTask });

  await insertTeamMember(database, {
    id: ids.startingMember,
    teamRunId: ids.teamRun,
    name: 'starting-member',
    role: 'member',
    agentVersionId: ids.workerAgentVersion,
    status: 'starting',
    owner: ownerA,
  });
}

async function seedForeignTenantLeakAttempt(database: PGlite): Promise<void> {
  // Branch 1 leak attempt: a foreign tenant's Task/Run under the SAME
  // root_task_id. Only the t.tenant_id/workspace_id predicate on the
  // activity-derived branch stops this from crossing tenants.
  await insertChildTask(database, {
    id: ids.foreignTaskLeak,
    rootTaskId: ids.teamRootTask,
    parentTaskId: ids.teamRootTask,
    parentRunId: ids.teamRootRun,
    invokableVersionId: 'foreign-invokable-fixture',
    teamMemberRunId: null,
    owner: ownerB,
  });
  await insertSucceededRun(database, {
    id: ids.foreignRunLeak,
    taskId: ids.foreignTaskLeak,
  });

  // Branch 2 leak attempt: a foreign tenant's roster member attached to the
  // SAME TeamRun row. Only the m.tenant_id/workspace_id predicate on the
  // roster-derived branch stops this from crossing tenants.
  await insertTeamMember(database, {
    id: ids.foreignMemberLeak,
    teamRunId: ids.teamRun,
    name: 'foreign-leak-member',
    role: 'member',
    agentVersionId: ids.workerAgentVersion,
    status: 'starting',
    owner: ownerB,
  });
}

describe('PostgresSessionTranscriptFactsQuery (PGlite)', () => {
  it('returns exactly one agent_runs stream for a single-agent root task', async () => {
    const database = await createDatabase();
    await seedSoloAgentFixture(database);
    const query = new PostgresSessionTranscriptFactsQuery(database);

    const streams = await query.listByRootTask({
      ...ownerA,
      rootTaskId: ids.soloRootTask,
    });

    expect(streams).toHaveLength(1);
    const [stream] = streams;
    expect(stream).toMatchObject({
      name: 'Solo Agent',
      role: null,
      status: 'succeeded',
      statusBasis: 'agent_runs',
      sourceRefs: { taskId: ids.soloRootTask },
    });
    expect(stream!.runs).toHaveLength(1);
    expect(stream!.runs[0]).toMatchObject({
      runId: ids.soloRun,
      taskId: ids.soloRootTask,
      provider: 'paseo',
      model: 'free-model',
    });
  });

  it('yields a stream per Team member with tasks, matching the prior Team behaviour', async () => {
    const database = await createDatabase();
    await seedTeamFixture(database);
    const query = new PostgresSessionTranscriptFactsQuery(database);

    const streams = await query.listByRootTask({
      ...ownerA,
      rootTaskId: ids.teamRootTask,
    });

    const withTasks = streams.filter((stream) => stream.runs.length > 0);
    expect(withTasks).toHaveLength(2);

    const lead = withTasks.find((stream) => stream.name === 'lead');
    expect(lead).toMatchObject({
      name: 'lead',
      role: 'lead',
      status: 'active',
      statusBasis: 'team_member_run',
      sourceRefs: { teamMemberRunId: ids.leadMember },
    });
    expect(lead!.runs).toHaveLength(1);
    expect(lead!.runs[0]).toMatchObject({ runId: ids.leadRun });

    const worker = withTasks.find((stream) => stream.name === 'worker');
    expect(worker).toMatchObject({
      name: 'worker',
      role: 'member',
      status: 'idle',
      statusBasis: 'team_member_run',
      sourceRefs: { teamMemberRunId: ids.workerMember },
    });
    expect(worker!.runs).toHaveLength(1);
    expect(worker!.runs[0]).toMatchObject({ runId: ids.workerRun });
  });

  it('keeps a starting Team member with no Task visible via the roster branch', async () => {
    const database = await createDatabase();
    await seedTeamFixture(database);
    const query = new PostgresSessionTranscriptFactsQuery(database);

    const streams = await query.listByRootTask({
      ...ownerA,
      rootTaskId: ids.teamRootTask,
    });

    const starting = streams.find((stream) => stream.name === 'starting-member');
    expect(starting).toMatchObject({
      name: 'starting-member',
      role: 'member',
      status: 'starting',
      statusBasis: 'team_member_run',
      sourceRefs: { teamMemberRunId: ids.startingMember },
    });
    expect(starting!.runs).toEqual([]);
  });

  it('never returns a second tenant row for either branch', async () => {
    const database = await createDatabase();
    await seedTeamFixture(database);
    await seedForeignTenantLeakAttempt(database);
    const query = new PostgresSessionTranscriptFactsQuery(database);

    const streams = await query.listByRootTask({
      ...ownerA,
      rootTaskId: ids.teamRootTask,
    });

    expect(streams.some((stream) => stream.name === 'foreign-leak-member')).toBe(
      false,
    );
    expect(
      streams.some((stream) =>
        stream.runs.some((run) => run.runId === ids.foreignRunLeak),
      ),
    ).toBe(false);
    expect(
      streams.some(
        (stream) => stream.sourceRefs.teamMemberRunId === ids.foreignMemberLeak,
      ),
    ).toBe(false);
    expect(
      streams.some((stream) => stream.sourceRefs.taskId === ids.foreignTaskLeak),
    ).toBe(false);
  });
});
