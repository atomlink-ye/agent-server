import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type OwnerScope,
  type TeamExecutionRepository,
} from '../../src/application/ports/team-execution-repository.js';
import { PostgresTeamExecutionRepository } from '../../src/infrastructure/postgres/postgres-collaborative-team-repository.js';
import { PostgresTaskRepository } from '../../src/infrastructure/postgres/postgres-task-repository.js';
import { PostgresAdmissionRepository } from '../../src/infrastructure/postgres/postgres-admission-repository.js';
import { PostgresTeamMessageRepository } from '../../src/infrastructure/postgres/postgres-team-message-repository.js';
import { CollaborationActivationReconciler } from '../../src/application/collaboration/collaboration-activation-reconciler.js';
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
  builderMemberId: string;
  analystMemberId: string;
  builderWorkItemId: string;
  openWorkItemId: string;
};

async function seedFixture(database: Pool): Promise<Fixture> {
  const fixture: Fixture = {
    owner: {
      tenantId: `reconciler_concurrent_${randomUUID()}`,
      workspaceId: randomUUID(),
      principalType: 'service_account',
      principalId: 'reconciler-concurrent-owner',
    },
    teamRunId: randomUUID(),
    rootTaskId: randomUUID(),
    rootRunId: randomUUID(),
    leadMemberId: randomUUID(),
    builderMemberId: randomUUID(),
    analystMemberId: randomUUID(),
    builderWorkItemId: randomUUID(),
    openWorkItemId: randomUUID(),
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

  // Create lead member (mark as active so it won't be processed again)
  await database.query(
    `INSERT INTO team_member_runs(
      id,team_run_id,name,role,agent_version_id,runtime_session_id,status,
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

  // Create builder member (idle)
  await database.query(
    `INSERT INTO team_member_runs(
      id,team_run_id,name,role,agent_version_id,runtime_session_id,status,
      tenant_id,workspace_id,principal_type,principal_id,created_at,updated_at
    ) VALUES ($1,$2,'Builder','member',$3,NULL,'idle',$4,$5,$6,$7,$8,$8)`,
    [
      fixture.builderMemberId,
      fixture.teamRunId,
      randomUUID(),
      owner.tenantId,
      owner.workspaceId,
      owner.principalType,
      owner.principalId,
      timestamp,
    ],
  );

  // Create analyst member (idle)
  await database.query(
    `INSERT INTO team_member_runs(
      id,team_run_id,name,role,agent_version_id,runtime_session_id,status,
      tenant_id,workspace_id,principal_type,principal_id,created_at,updated_at
    ) VALUES ($1,$2,'Analyst','member',$3,NULL,'idle',$4,$5,$6,$7,$8,$8)`,
    [
      fixture.analystMemberId,
      fixture.teamRunId,
      randomUUID(),
      owner.tenantId,
      owner.workspaceId,
      owner.principalType,
      owner.principalId,
      timestamp,
    ],
  );

  // Create work items (mimics the real smoke test scenario with owned + open items)
  // W-1: assigned to builder (owned work item)
  await database.query(
    `INSERT INTO team_work_items(
      id,team_run_id,subject,description,status,owner_member_id,created_by_member_id,
      completion_summary,execution_task_id,tenant_id,workspace_id,principal_type,
      principal_id,created_at,updated_at,completed_at
    ) VALUES ($1,$2,'Build component','builder task'::text,'open',$3,$4,NULL,NULL,$5,$6,$7,$8,$9,$9,NULL)`,
    [
      fixture.builderWorkItemId,
      fixture.teamRunId,
      fixture.builderMemberId,
      fixture.leadMemberId,
      owner.tenantId,
      owner.workspaceId,
      owner.principalType,
      owner.principalId,
      timestamp,
    ],
  );

  // W-2: open (no owner, waiting for analyst to discover via openActionable logic)
  await database.query(
    `INSERT INTO team_work_items(
      id,team_run_id,subject,description,status,owner_member_id,created_by_member_id,
      completion_summary,execution_task_id,tenant_id,workspace_id,principal_type,
      principal_id,created_at,updated_at,completed_at
    ) VALUES ($1,$2,'Review results','analyst task'::text,'open',NULL,$3,NULL,NULL,$4,$5,$6,$7,$8,$8,NULL)`,
    [
      fixture.openWorkItemId,
      fixture.teamRunId,
      fixture.leadMemberId,
      owner.tenantId,
      owner.workspaceId,
      owner.principalType,
      owner.principalId,
      timestamp,
    ],
  );

  return fixture;
}

describe('Collaboration activation reconciler concurrent materialization', () => {
  let pool: Pool;
  let taskRepository: PostgresTaskRepository;
  let admissionRepository: PostgresAdmissionRepository;
  let executionRepository: TeamExecutionRepository;
  let messageRepository: PostgresTeamMessageRepository;

  beforeAll(async () => {
    pool = createPostgresPool({ connectionString });
    await applyDurableKernelMigrations(pool);
    taskRepository = new PostgresTaskRepository(pool);
    admissionRepository = new PostgresAdmissionRepository(pool);
    executionRepository = new PostgresTeamExecutionRepository(pool);
    messageRepository = new PostgresTeamMessageRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('concurrent reconcileForRootTask calls should activate all idle members without deadlock', async () => {
    const fixture = await seedFixture(pool);
    const owner = fixture.owner;

    // Create two independent reconciler instances
    const reconciler1 = new CollaborationActivationReconciler(
      messageRepository,
      executionRepository,
      taskRepository,
      admissionRepository,
    );
    const reconciler2 = new CollaborationActivationReconciler(
      messageRepository,
      executionRepository,
      taskRepository,
      admissionRepository,
    );

    // Verify initial state: both members are idle
    const builderBefore = await executionRepository.findMemberRunById(
      fixture.builderMemberId,
      owner,
    );
    const analystBefore = await executionRepository.findMemberRunById(
      fixture.analystMemberId,
      owner,
    );
    expect(builderBefore?.status).toBe('idle');
    expect(analystBefore?.status).toBe('idle');

    // Launch two concurrent reconciliation attempts
    // Both are processing the same team with two idle members:
    // - builder has owned work (W-1, assigned to them)
    // - analyst will discover open work (W-2, no owner, openActionable path)
    //
    // Without the fix: first reconciler claims builder, second fails on conflict,
    // falsely reports success, and analyst never gets activated (stays idle).
    //
    // With the fix: if second reconciler hits conflict on builder, it continues
    // to next candidate (analyst) and activates them instead.
    const [result1, result2] = await Promise.all([
      reconciler1.reconcileForRootTask(fixture.rootTaskId, owner),
      reconciler2.reconcileForRootTask(fixture.rootTaskId, owner),
    ]);

    // Check final member states
    const builderAfter = await executionRepository.findMemberRunById(
      fixture.builderMemberId,
      owner,
    );
    const analystAfter = await executionRepository.findMemberRunById(
      fixture.analystMemberId,
      owner,
    );

    console.log('DEBUG: result1 materialized:', result1);
    console.log('DEBUG: result2 materialized:', result2);
    console.log('DEBUG: builderAfter.status:', builderAfter?.status);
    console.log('DEBUG: analystAfter.status:', analystAfter?.status);

    // Both members MUST be activated when running the fixed code
    // If the bug is present, analyst stays idle
    expect(builderAfter?.status).toBe('active');
    expect(analystAfter?.status).toBe('active');
  });
});
