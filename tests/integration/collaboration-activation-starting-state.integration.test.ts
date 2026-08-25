import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  TeamExecutionError,
  type OwnerScope,
  type TeamExecutionRepository,
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
};

async function seedFixture(database: Pool): Promise<Fixture> {
  const fixture: Fixture = {
    owner: {
      tenantId: `starting_state_${randomUUID()}`,
      workspaceId: randomUUID(),
      principalType: 'service_account',
      principalId: 'starting-state-owner',
    },
    teamRunId: randomUUID(),
    rootTaskId: randomUUID(),
    rootRunId: randomUUID(),
    leadMemberId: randomUUID(),
    memberId: randomUUID(),
  };
  const timestamp = '2026-08-11T00:00:00.000Z';
  const owner = fixture.owner;

  // Create root task
  await database.query(
    `INSERT INTO tasks(
      id,root_task_id,parent_task_id,parent_run_id,depth,status,ingress,
      invokable_kind,invokable_version_id,input_snapshot_ref,input_fingerprint,
      created_at,updated_at,tenant_id,workspace_id,principal_type,principal_id,
      policy_snapshot_version
    ) VALUES ($1,$1,NULL,NULL,0,'active','api','team',$2,'starting-root','starting-root',$3,$3,$4,$5,$6,$7,'starting-policy')`,
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

  // Create root run
  await database.query(
    `INSERT INTO runs(
      id,task_id,attempt,status,lease_owner,activation_id,lease_expires_at,
      fencing_token,result,error,created_at,updated_at
    ) VALUES ($1,$2,1,'waiting_children',NULL,NULL,NULL,1,NULL,NULL,$3,$3)`,
    [fixture.rootRunId, fixture.rootTaskId, timestamp],
  );

  // Create team run
  await database.query(
    `INSERT INTO team_runs(
      id,tenant_id,workspace_id,principal_type,principal_id,root_task_id,root_run_id,
      team_version_id,environment_version_id,status,phase,control_state,revision,lead_turn_count,
      completion_approval_required,created_at,updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active','member_work','member_work_running',1,0,false,$10,$10)`,
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

  // Create lead member with 'active' status (as per team-driver.ts which activates lead at creation)
  await database.query(
    `INSERT INTO team_member_runs(
      id,team_run_id,name,role,worker_version_id,runtime_session_id,status,
      tenant_id,workspace_id,principal_type,principal_id,created_at,updated_at
    ) VALUES ($1,$2,'Lead','lead',$3,NULL,'active',$4,$5,$6,$7,$8,$8)`,
    [
      fixture.leadMemberId,
      fixture.teamRunId,
      randomUUID(),
      owner.tenantId,
      owner.workspaceId,
      owner.principalType,
      owner.principalId,
      timestamp,
    ],
  );

  // Create regular member with 'starting' status (as per createTeamMemberRun() which initializes with 'starting')
  // This is the real production scenario that the previous fixture didn't test
  await database.query(
    `INSERT INTO team_member_runs(
      id,team_run_id,name,role,worker_version_id,runtime_session_id,status,
      tenant_id,workspace_id,principal_type,principal_id,created_at,updated_at
    ) VALUES ($1,$2,'Member','member',$3,NULL,'starting',$4,$5,$6,$7,$8,$8)`,
    [
      fixture.memberId,
      fixture.teamRunId,
      randomUUID(),
      owner.tenantId,
      owner.workspaceId,
      owner.principalType,
      owner.principalId,
      timestamp,
    ],
  );

  return fixture;
}

describe('Collaboration activation with starting state', () => {
  let pool: Pool;
  let repository: TeamExecutionRepository;

  beforeAll(async () => {
    pool = createPostgresPool({ connectionString });
    await applyDurableKernelMigrations(pool);
    repository = new PostgresTeamExecutionRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('activates member from starting state with expectedCurrentStatus array', async () => {
    const fixture = await seedFixture(pool);

    // Verify member starts in 'starting' state (true production scenario)
    const before = await repository.findMemberRunById(
      fixture.memberId,
      fixture.owner,
    );
    expect(before?.status).toBe('starting');

    // Activate with expectedCurrentStatus accepting both 'starting' and 'idle'
    const member = await repository.updateMemberRunStatus(
      fixture.memberId,
      'active',
      undefined,
      fixture.owner,
      ['starting', 'idle'],
    );

    // Should succeed because 'starting' is in the allowed set
    expect(member.status).toBe('active');

    // Verify final state
    const after = await repository.findMemberRunById(
      fixture.memberId,
      fixture.owner,
    );
    expect(after?.status).toBe('active');
  });

  it('rejects activation when member is in unexpected state', async () => {
    const fixture = await seedFixture(pool);

    // First activation succeeds
    const member = await repository.updateMemberRunStatus(
      fixture.memberId,
      'active',
      undefined,
      fixture.owner,
      ['starting', 'idle'],
    );
    expect(member.status).toBe('active');

    // Second activation attempt should fail because member is now 'active'
    // which is not in the allowed set ['starting', 'idle']
    await expect(
      repository.updateMemberRunStatus(
        fixture.memberId,
        'active',
        undefined,
        fixture.owner,
        ['starting', 'idle'],
      ),
    ).rejects.toThrow(
      expect.objectContaining({
        code: 'conflict',
      }),
    );

    // Verify member is still active
    const current = await repository.findMemberRunById(
      fixture.memberId,
      fixture.owner,
    );
    expect(current?.status).toBe('active');
  });

  it('supports single status (backward compatible)', async () => {
    const fixture = await seedFixture(pool);

    // Verify member is in starting state
    const before = await repository.findMemberRunById(
      fixture.memberId,
      fixture.owner,
    );
    expect(before?.status).toBe('starting');

    // Update with single expectedCurrentStatus='starting' should work
    const member = await repository.updateMemberRunStatus(
      fixture.memberId,
      'active',
      undefined,
      fixture.owner,
      'starting',
    );
    expect(member.status).toBe('active');
  });

  it('prevents concurrent activation from starting state', async () => {
    const fixture = await seedFixture(pool);

    // Verify member starts in 'starting' state
    const before = await repository.findMemberRunById(
      fixture.memberId,
      fixture.owner,
    );
    expect(before?.status).toBe('starting');

    // Launch two concurrent attempts to activate the same member
    const results = await Promise.allSettled([
      repository.updateMemberRunStatus(
        fixture.memberId,
        'active',
        undefined,
        fixture.owner,
        ['starting', 'idle'],
      ),
      repository.updateMemberRunStatus(
        fixture.memberId,
        'active',
        undefined,
        fixture.owner,
        ['starting', 'idle'],
      ),
    ]);

    // One should succeed, one should fail
    const successes = results.filter((r) => r.status === 'fulfilled');
    const failures = results.filter((r) => r.status === 'rejected');
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    // The failure should be conflict error
    const failedReason = failures[0];
    if (failedReason) {
      expect(failedReason.status).toBe('rejected');
      if (failedReason.status === 'rejected') {
        expect(failedReason.reason).toBeInstanceOf(TeamExecutionError);
        expect((failedReason.reason as TeamExecutionError).code).toBe(
          'conflict',
        );
      }
    }

    // Verify final state: member is active (only one activation succeeded)
    const after = await repository.findMemberRunById(
      fixture.memberId,
      fixture.owner,
    );
    expect(after?.status).toBe('active');
  });
});

// Helper functions from the repository implementation
function ownerValues(owner: OwnerScope): readonly unknown[] {
  return [
    owner.tenantId,
    owner.workspaceId,
    owner.principalType,
    owner.principalId,
  ];
}

function ownerSql(tablePrefix: string, startParam: number): string {
  const prefix = tablePrefix ? `${tablePrefix}.` : '';
  return `${prefix}tenant_id=$${startParam} AND ${prefix}workspace_id=$${startParam + 1} AND ${prefix}principal_type=$${startParam + 2} AND ${prefix}principal_id=$${startParam + 3}`;
}
