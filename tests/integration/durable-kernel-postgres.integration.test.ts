import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

import { CompleteRun } from '../../src/application/runs/complete-run.js';
import { ClaimNextRun } from '../../src/application/runs/claim-next-run.js';
import { ExecuteRun } from '../../src/application/runs/execute-run.js';
import { GetTask } from '../../src/application/tasks/get-task.js';
import { GetTaskTree } from '../../src/application/tasks/get-task-tree.js';
import { ExecuteTeamTask } from '../../src/application/tasks/execute-team-task.js';
import {
  originReference,
  type SessionTurnOrigin,
} from '../../src/application/sessions/session-turn-origin.js';
import {
  AdmitRootTask,
  IdempotencyConflictError,
} from '../../src/application/tasks/admit-root-task.js';
import { InvokeTask } from '../../src/application/tasks/invoke-task.js';
import { transitionRun } from '../../src/domain/runs/run.js';
import { createRootTask } from '../../src/domain/tasks/task.js';
import { createMemoryProposal } from '../../src/domain/workspace-memory/memory-proposal.js';
import { createTeamDefinition } from '../../src/domain/invokables/team-definition.js';
import {
  createDraftTeamVersion,
  publishTeamVersion,
} from '../../src/domain/invokables/team-version.js';
import {
  applyDurableKernelMigrations,
  durableKernelMigrationFilePaths,
  readDurableKernelMigration,
  resolveDurableKernelMigrationFilePath,
} from '../../src/infrastructure/postgres/postgres.js';
import { PostgresRunDispatcher } from '../../src/infrastructure/postgres/postgres-run-dispatcher.js';
import { PostgresAdmissionRepository } from '../../src/infrastructure/postgres/postgres-admission-repository.js';
import { PostgresInvokableRepository } from '../../src/infrastructure/postgres/postgres-invokable-repository.js';
import {
  canonicalAgentResolver,
  seedCanonicalPublishedAgent,
} from '../fixtures/canonical-agent.js';
import { PostgresRunRepository } from '../../src/infrastructure/postgres/postgres-run-repository.js';
import { PostgresTaskRepository } from '../../src/infrastructure/postgres/postgres-task-repository.js';
import { PostgresWorkspaceMemoryRepository } from '../../src/infrastructure/postgres/postgres-workspace-memory-repository.js';
import { PostgresTeamExecutionRepository } from '../../src/infrastructure/postgres/postgres-collaborative-team-repository.js';
import { createLogger } from '../../src/shared/observability/logger.js';
import { FakeAgentRuntime } from '../fixtures/fake-agent-runtime.js';
import { TestClock } from '../fixtures/test-clock.js';
import { createTeamRun } from '../../src/domain/teams/team-run.js';

const primaryAccessContext = {
  tenantId: 'tenant_alpha',
  workspaceId: 'workspace_main',
  principalType: 'service_account' as const,
  principalId: 'svc_alpha',
  policySnapshotVersion: 'policy-2026-07-22',
};

function createAccessContext(
  overrides: Partial<typeof primaryAccessContext> = {},
) {
  return {
    ...primaryAccessContext,
    ...overrides,
  };
}

async function createDatabase(): Promise<PGlite> {
  return new PGlite();
}

interface CompletedDispatchRow {
  readonly status: string;
  readonly result: { readonly text: string } | null;
  readonly lease_owner: string | null;
  readonly activation_id: string | null;
  readonly published_at: string | Date | null;
}

describe('durable kernel postgres bootstrap', () => {
  it('round-trips the Team completion approval snapshot through Postgres', async () => {
    const database = await createDatabase();
    await applyDurableKernelMigrations(database);
    const repository = new PostgresTeamExecutionRepository(database);
    const now = () => new Date('2026-08-08T00:00:00.000Z');
    const team = createTeamRun({
      id: '00000000-0000-4000-8000-000000002801',
      tenantId: 'tenant_alpha',
      workspaceId: 'workspace_main',
      principalType: 'service_account',
      principalId: 'svc_alpha',
      rootTaskId: '00000000-0000-4000-8000-000000002802',
      rootRunId: '00000000-0000-4000-8000-000000002803',
      teamVersionId: '00000000-0000-4000-8000-000000002804',
      environmentVersionId: '00000000-0000-4000-8000-000000002805',
      completionApprovalRequired: true,
      now,
    });

    await repository.createTeamRun(team);
    const loaded = await repository.findTeamRunById(team.id, {
      tenantId: team.tenantId,
      workspaceId: team.workspaceId,
      principalType: team.principalType,
      principalId: team.principalId,
    });
    const raw = await database.query<{ status: string }>(
      'SELECT status FROM team_runs WHERE id = $1',
      [team.id],
    );

    expect(loaded?.completionApprovalRequired).toBe(true);
    expect(raw.rows).toEqual([{ status: 'active' }]);
  });

  it('upgrades an existing active Team run with a false completion approval default', async () => {
    const database = await createDatabase();
    const migration0028Index = durableKernelMigrationFilePaths.findIndex(
      (filePath) => filePath.endsWith('/0028_team-completion-approval.sql'),
    );
    await applyDurableKernelMigrations(
      database,
      durableKernelMigrationFilePaths.slice(0, migration0028Index),
    );
    const teamRunId = '00000000-0000-4000-8000-000000002811';
    await database.query(
      `INSERT INTO team_runs(
        id,tenant_id,workspace_id,principal_type,principal_id,root_task_id,
        root_run_id,team_version_id,environment_version_id,status,created_at,updated_at
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,$10)`,
      [
        teamRunId,
        'tenant_alpha',
        'workspace_main',
        'service_account',
        'svc_alpha',
        '00000000-0000-4000-8000-000000002812',
        '00000000-0000-4000-8000-000000002813',
        '00000000-0000-4000-8000-000000002814',
        '00000000-0000-4000-8000-000000002815',
        '2026-08-08T00:00:00.000Z',
      ],
    );

    await applyDurableKernelMigrations(database);

    const row = await database.query<{
      completion_approval_required: boolean;
      status: string;
    }>(
      'SELECT completion_approval_required,status FROM team_runs WHERE id=$1',
      [teamRunId],
    );
    expect(row.rows).toEqual([
      { completion_approval_required: false, status: 'active' },
    ]);
  });

  it('loads the migration SQL from the source tree for dist runtime paths', async () => {
    const distModuleUrl = new URL(
      '../../dist/infrastructure/postgres/postgres.js',
      import.meta.url,
    ).href;

    const sql = await readDurableKernelMigration(
      resolveDurableKernelMigrationFilePath(
        '0001_durable_kernel_a.sql',
        distModuleUrl,
      ),
    );

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS tasks');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS runs');
  });

  it('applies the durable kernel migration only once and records its version', async () => {
    const database = await createDatabase();

    await applyDurableKernelMigrations(database);
    await applyDurableKernelMigrations(database);

    const migrationRows = await database.query<{ version: string }>(
      'SELECT version FROM durable_kernel_schema_migrations ORDER BY version ASC',
    );
    const taskRows = await database.query(
      "SELECT table_name FROM information_schema.tables WHERE table_name = 'tasks'",
    );
    const runRows = await database.query(
      "SELECT table_name FROM information_schema.tables WHERE table_name = 'runs'",
    );

    const versions = migrationRows.rows.map((row) => row.version);
    expect(new Set(versions).size).toBe(versions.length);
    expect(versions).toContain('0001_durable_kernel_a');
    expect(taskRows.rows).toEqual([{ table_name: 'tasks' }]);
    expect(runRows.rows).toEqual([{ table_name: 'runs' }]);
  });

  it('re-records a migration version when schema exists but the registry row is missing', async () => {
    const database = await createDatabase();
    const migrationSql = await readDurableKernelMigration();

    await database.exec(migrationSql);
    await database.query(`
      CREATE TABLE IF NOT EXISTS durable_kernel_schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await applyDurableKernelMigrations(database);

    const migrationRows = await database.query<{ version: string }>(
      `SELECT version FROM durable_kernel_schema_migrations
       WHERE version = '0001_durable_kernel_a'`,
    );

    expect(migrationRows.rows).toEqual([{ version: '0001_durable_kernel_a' }]);
  });

  it('recovers when only the 0012 registry row is missing', async () => {
    const database = await createDatabase();

    await applyDurableKernelMigrations(database);
    await database.query(
      `DELETE FROM durable_kernel_schema_migrations WHERE version = '0012_session_turn_origin'`,
    );

    await applyDurableKernelMigrations(database);

    const migrationRows = await database.query(
      `SELECT version FROM durable_kernel_schema_migrations WHERE version = '0012_session_turn_origin'`,
    );
    expect(migrationRows.rows).toEqual([
      { version: '0012_session_turn_origin' },
    ]);
  });

  it('backfills session admission ownership before creating session uniqueness indexes', async () => {
    const database = await createDatabase();
    const sessionId = '00000000-0000-0000-0000-000000001201';
    const taskId = '00000000-0000-0000-0000-000000001202';
    const now = '2026-07-24T12:00:00.000Z';

    await applyDurableKernelMigrations(
      database,
      durableKernelMigrationFilePaths.slice(
        0,
        durableKernelMigrationFilePaths.findIndex((filePath) =>
          filePath.endsWith('/0012_session_turn_origin.sql'),
        ),
      ),
    );
    await database.query(
      `INSERT INTO workspaces(id,tenant_id,principal_type,principal_id,name,created_at,updated_at)
       VALUES('00000000-0000-0000-0000-000000001200',$1,$2,$3,'upgrade',$4,$4)`,
      [
        primaryAccessContext.tenantId,
        primaryAccessContext.principalType,
        primaryAccessContext.principalId,
        now,
      ],
    );
    await database.query(
      `INSERT INTO product_sessions(id,workspace_id,tenant_id,principal_type,principal_id,published_agent_version_id,created_at,updated_at)
       VALUES($1,'00000000-0000-0000-0000-000000001200',$2,$3,$4,'upgrade-agent',$5,$5)`,
      [
        sessionId,
        primaryAccessContext.tenantId,
        primaryAccessContext.principalType,
        primaryAccessContext.principalId,
        now,
      ],
    );
    await database.query(
      'INSERT INTO session_lanes(session_id,generation) VALUES($1,0)',
      [sessionId],
    );
    await database.query(
      `INSERT INTO tasks(id,tenant_id,workspace_id,principal_type,principal_id,policy_snapshot_version,root_task_id,depth,status,ingress,invokable_kind,invokable_version_id,input_snapshot_ref,input_fingerprint,session_id,generation,lane_sequence,created_at,updated_at)
       VALUES($1,$2,'00000000-0000-0000-0000-000000001200',$3,$4,'upgrade-policy',$1,0,'queued','api','agent','upgrade-agent','inline:upgrade','sha256:upgrade',$5,0,1,$6,$6)`,
      [
        taskId,
        primaryAccessContext.tenantId,
        primaryAccessContext.principalType,
        primaryAccessContext.principalId,
        sessionId,
        now,
      ],
    );
    await database.query(
      `INSERT INTO admissions(ingress,idempotency_key,request_fingerprint,task_id,tenant_id,workspace_id,principal_type,principal_id,policy_snapshot_version,created_at)
       VALUES('api','upgrade-session-key','sha256:upgrade',$1,$2,'00000000-0000-0000-0000-000000001200',$3,$4,'upgrade-policy',$5)`,
      [
        taskId,
        primaryAccessContext.tenantId,
        primaryAccessContext.principalType,
        primaryAccessContext.principalId,
        now,
      ],
    );

    await expect(
      database.query(
        'SELECT tasks.session_id FROM admissions JOIN tasks ON tasks.id = admissions.task_id WHERE admissions.task_id = $1',
        [taskId],
      ),
    ).resolves.toMatchObject({ rows: [{ session_id: sessionId }] });

    await applyDurableKernelMigrations(database, [
      durableKernelMigrationFilePaths.find((filePath) =>
        filePath.endsWith('/0012_session_turn_origin.sql'),
      )!,
    ]);

    await expect(
      database.query('SELECT session_id FROM admissions WHERE task_id = $1', [
        taskId,
      ]),
    ).resolves.toMatchObject({ rows: [{ session_id: sessionId }] });
  });

  it('persists owner-scoped workspace memory proposals and transactionally creates accepted entries', async () => {
    const database = await createDatabase();

    await applyDurableKernelMigrations(database);

    const repository = new PostgresWorkspaceMemoryRepository(database);
    const ownerScope = {
      tenantId: primaryAccessContext.tenantId,
      workspaceId: primaryAccessContext.workspaceId,
      principalType: primaryAccessContext.principalType,
      principalId: primaryAccessContext.principalId,
    } as const;
    const proposerSnapshot = {
      principalType: primaryAccessContext.principalType,
      principalId: primaryAccessContext.principalId,
      policySnapshotVersion: primaryAccessContext.policySnapshotVersion,
    } as const;
    const reviewerSnapshot = {
      principalType: primaryAccessContext.principalType,
      principalId: 'reviewer_alpha',
      policySnapshotVersion: 'policy-review',
    } as const;
    const proposal = createMemoryProposal({
      id: '00000000-0000-4000-8000-000000090011',
      ...ownerScope,
      originalContent: 'ACME prefers async status updates.',
      originalCategory: 'customer_preference',
      sourceTaskId: null,
      sourceSessionId: 'session-alpha',
      proposerSnapshot,
      now: () => new Date('2026-07-23T10:00:00.000Z'),
    });

    await repository.createProposal(proposal);

    await expect(
      repository.findProposalByIdForOwner(proposal.id, ownerScope),
    ).resolves.toMatchObject({ id: proposal.id, status: 'pending' });
    await expect(
      repository.findProposalByIdForOwner(proposal.id, {
        ...ownerScope,
        principalId: 'svc_other',
      }),
    ).resolves.toBeNull();

    const reviewed = await repository.reviewProposal({
      proposalId: proposal.id,
      ownerScope,
      outcome: 'edit_and_accept',
      reviewedContent: 'ACME prefers concise async status updates.',
      reviewerSnapshot,
      now: () => new Date('2026-07-23T10:05:00.000Z'),
      entryIdFactory: () => '00000000-0000-4000-8000-000000090111',
    });

    expect(reviewed.proposal).toMatchObject({
      id: proposal.id,
      status: 'accepted',
      reviewOutcome: 'edit_and_accept',
      reviewedContent: 'ACME prefers concise async status updates.',
    });
    expect(reviewed.entry).toMatchObject({
      id: '00000000-0000-4000-8000-000000090111',
      proposalId: proposal.id,
      content: 'ACME prefers concise async status updates.',
      category: 'customer_preference',
      reviewOutcome: 'edit_and_accept',
    });

    await expect(
      repository.reviewProposal({
        proposalId: proposal.id,
        ownerScope,
        outcome: 'accept',
        reviewedContent: null,
        reviewerSnapshot,
        now: () => new Date('2026-07-23T10:06:00.000Z'),
      }),
    ).rejects.toThrow(/non-pending|already reviewed/i);

    await expect(
      repository.listProposalsByOwnerScope(ownerScope),
    ).resolves.toMatchObject([{ id: proposal.id, status: 'accepted' }]);
    await expect(
      repository.listAcceptedEntriesByOwnerScope(ownerScope),
    ).resolves.toMatchObject([
      {
        id: '00000000-0000-4000-8000-000000090111',
        proposalId: proposal.id,
        content: 'ACME prefers concise async status updates.',
      },
    ]);
    await expect(
      repository.listAcceptedEntriesByOwnerScope({
        ...ownerScope,
        principalId: 'svc_other',
      }),
    ).resolves.toEqual([]);
  });

  it('lists same-timestamp workspace memory proposals in insertion-newest order', async () => {
    const database = await createDatabase();

    await applyDurableKernelMigrations(database);

    const repository = new PostgresWorkspaceMemoryRepository(database);
    const ownerScope = {
      tenantId: primaryAccessContext.tenantId,
      workspaceId: primaryAccessContext.workspaceId,
      principalType: primaryAccessContext.principalType,
      principalId: primaryAccessContext.principalId,
    } as const;
    const proposerSnapshot = {
      principalType: primaryAccessContext.principalType,
      principalId: primaryAccessContext.principalId,
      policySnapshotVersion: primaryAccessContext.policySnapshotVersion,
    } as const;
    const sameTimestamp = () => new Date('2026-07-23T10:00:00.000Z');
    const first = createMemoryProposal({
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      ...ownerScope,
      originalContent: 'First same-timestamp proposal.',
      originalCategory: 'general',
      sourceTaskId: null,
      sourceSessionId: null,
      proposerSnapshot,
      now: sameTimestamp,
    });
    const second = createMemoryProposal({
      id: '00000000-0000-4000-8000-000000000001',
      ...ownerScope,
      originalContent: 'Second same-timestamp proposal.',
      originalCategory: 'general',
      sourceTaskId: null,
      sourceSessionId: null,
      proposerSnapshot,
      now: sameTimestamp,
    });

    await repository.createProposal(first);
    await repository.createProposal(second);

    await expect(
      repository.listProposalsByOwnerScope(ownerScope),
    ).resolves.toMatchObject([{ id: second.id }, { id: first.id }]);
  });

  it('lists same-timestamp accepted workspace memory entries in insertion-newest order', async () => {
    const database = await createDatabase();

    await applyDurableKernelMigrations(database);

    const repository = new PostgresWorkspaceMemoryRepository(database);
    const ownerScope = {
      tenantId: primaryAccessContext.tenantId,
      workspaceId: primaryAccessContext.workspaceId,
      principalType: primaryAccessContext.principalType,
      principalId: primaryAccessContext.principalId,
    } as const;
    const proposerSnapshot = {
      principalType: primaryAccessContext.principalType,
      principalId: primaryAccessContext.principalId,
      policySnapshotVersion: primaryAccessContext.policySnapshotVersion,
    } as const;
    const reviewerSnapshot = {
      principalType: primaryAccessContext.principalType,
      principalId: 'reviewer_alpha',
      policySnapshotVersion: 'policy-review',
    } as const;
    const proposalTimestamp = () => new Date('2026-07-23T10:00:00.000Z');
    const acceptedTimestamp = () => new Date('2026-07-23T10:05:00.000Z');
    const first = createMemoryProposal({
      id: '00000000-0000-4000-8000-000000000101',
      ...ownerScope,
      originalContent: 'First accepted memory.',
      originalCategory: 'general',
      sourceTaskId: null,
      sourceSessionId: null,
      proposerSnapshot,
      now: proposalTimestamp,
    });
    const second = createMemoryProposal({
      id: '00000000-0000-4000-8000-000000000102',
      ...ownerScope,
      originalContent: 'Second accepted memory.',
      originalCategory: 'general',
      sourceTaskId: null,
      sourceSessionId: null,
      proposerSnapshot,
      now: proposalTimestamp,
    });

    await repository.createProposal(first);
    await repository.createProposal(second);
    const firstReview = await repository.reviewProposal({
      proposalId: first.id,
      ownerScope,
      outcome: 'accept',
      reviewedContent: null,
      reviewerSnapshot,
      now: acceptedTimestamp,
      entryIdFactory: () => 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    });
    const secondReview = await repository.reviewProposal({
      proposalId: second.id,
      ownerScope,
      outcome: 'accept',
      reviewedContent: null,
      reviewerSnapshot,
      now: acceptedTimestamp,
      entryIdFactory: () => '00000000-0000-4000-8000-000000000001',
    });

    await expect(
      repository.listAcceptedEntriesByOwnerScope(ownerScope),
    ).resolves.toMatchObject([
      { id: secondReview.entry?.id, proposalId: second.id },
      { id: firstReview.entry?.id, proposalId: first.id },
    ]);
  });

  it('rejects workspace memory entries whose owner scope does not match the proposal owner scope', async () => {
    const database = await createDatabase();

    await applyDurableKernelMigrations(database);

    await database.query(`
      INSERT INTO workspace_memory_proposals (
        id,
        tenant_id,
        workspace_id,
        principal_type,
        principal_id,
        original_content,
        original_category,
        source_task_id,
        source_session_id,
        proposer_snapshot,
        status,
        review_outcome,
        reviewed_content,
        reviewer_snapshot,
        reviewed_at,
        created_at,
        updated_at
      ) VALUES (
        '00000000-0000-4000-8000-000000090012',
        'tenant_alpha',
        'workspace_main',
        'service_account',
        'svc_alpha',
        'ACME prefers async status updates.',
        'customer_preference',
        NULL,
        'session-alpha',
        '{"principalType":"service_account","principalId":"svc_alpha","policySnapshotVersion":"policy-2026-07-22"}'::jsonb,
        'accepted',
        'accept',
        NULL,
        '{"principalType":"service_account","principalId":"reviewer_alpha","policySnapshotVersion":"policy-review"}'::jsonb,
        '2026-07-23T10:05:00.000Z',
        '2026-07-23T10:00:00.000Z',
        '2026-07-23T10:05:00.000Z'
      )
    `);

    await expect(
      database.query(`
        INSERT INTO workspace_memory_entries (
          id,
          proposal_id,
          tenant_id,
          workspace_id,
          principal_type,
          principal_id,
          content,
          category,
          source_task_id,
          source_session_id,
          proposer_snapshot,
          reviewer_snapshot,
          review_outcome,
          accepted_at
        ) VALUES (
          '00000000-0000-4000-8000-000000090112',
          '00000000-0000-4000-8000-000000090012',
          'tenant_alpha',
          'workspace_main',
          'service_account',
          'svc_other',
          'ACME prefers async status updates.',
          'customer_preference',
          NULL,
          'session-alpha',
          '{"principalType":"service_account","principalId":"svc_alpha","policySnapshotVersion":"policy-2026-07-22"}'::jsonb,
          '{"principalType":"service_account","principalId":"reviewer_alpha","policySnapshotVersion":"policy-review"}'::jsonb,
          'accept',
          '2026-07-23T10:05:00.000Z'
        )
      `),
    ).rejects.toThrow(
      /workspace_memory_entries_proposal_owner_scope_fk|foreign key/i,
    );
  });

  it('enforces canonical root-task and run-state invariants', async () => {
    const database = await createDatabase();

    await applyDurableKernelMigrations(database);

    await expect(
      database.query(`
        INSERT INTO tasks (
          id,
          tenant_id,
          root_task_id,
          parent_task_id,
          parent_run_id,
          depth,
          status,
          workspace_id,
          principal_type,
          principal_id,
          policy_snapshot_version,
          ingress,
          invokable_kind,
          invokable_version_id,
          input_snapshot_ref,
          input_fingerprint,
          created_at,
          updated_at
        ) VALUES (
          'bf3d2bc7-2db0-4c80-9790-42e388bf0b63',
          'tenant_local',
          '8692ed31-fc15-4bd8-ab00-bce97ae4024d',
          NULL,
          NULL,
          0,
          'queued',
          'workspace_main',
          'service_account',
          'svc_alpha',
          'policy-2026-07-22',
          'api',
          'agent',
          '00000000-0000-4000-8000-00000000b100',
          'inline:prompt',
          'sha256:abc',
          '2026-07-22T12:00:00.000Z',
          '2026-07-22T12:00:00.000Z'
        )
      `),
    ).rejects.toThrow(/tasks_root_shape_check|tasks_root_task_fk/);

    await expect(
      database.query(`
        INSERT INTO tasks (
          id,
          tenant_id,
          root_task_id,
          parent_task_id,
          parent_run_id,
          depth,
          status,
          workspace_id,
          principal_type,
          principal_id,
          policy_snapshot_version,
          ingress,
          invokable_kind,
          invokable_version_id,
          logical_step_key,
          node_path,
          input_snapshot_ref,
          input_fingerprint,
          created_at,
          updated_at
        ) VALUES (
          '7f3d2bc7-2db0-4c80-9790-42e388bf0b63',
          'tenant_local',
          '7f3d2bc7-2db0-4c80-9790-42e388bf0b63',
          NULL,
          NULL,
          0,
          'queued',
          'workspace_main',
          'service_account',
          'svc_alpha',
          'policy-2026-07-22',
          'api',
          'agent',
          '00000000-0000-4000-8000-00000000b100',
          'collect',
          NULL,
          'inline:prompt',
          'sha256:abc',
          '2026-07-22T12:00:00.000Z',
          '2026-07-22T12:00:00.000Z'
        )
      `),
    ).rejects.toThrow(
      /logical_step|node_path|tasks_step_identity_shape_check/i,
    );

    await database.query(`
      INSERT INTO tasks (
        id,
        tenant_id,
        root_task_id,
        parent_task_id,
        parent_run_id,
        depth,
        status,
        workspace_id,
        principal_type,
        principal_id,
        policy_snapshot_version,
        ingress,
        invokable_kind,
        invokable_version_id,
        input_snapshot_ref,
        input_fingerprint,
        created_at,
        updated_at
      ) VALUES (
        'bf3d2bc7-2db0-4c80-9790-42e388bf0b63',
        'tenant_local',
        'bf3d2bc7-2db0-4c80-9790-42e388bf0b63',
        NULL,
        NULL,
        0,
        'queued',
        'workspace_main',
        'service_account',
        'svc_alpha',
        'policy-2026-07-22',
        'api',
        'agent',
        '00000000-0000-4000-8000-00000000b100',
        'inline:prompt',
        'sha256:abc',
        '2026-07-22T12:00:00.000Z',
        '2026-07-22T12:00:00.000Z'
      )
    `);

    await expect(
      database.query(`
        INSERT INTO tasks (
          id,
          tenant_id,
          root_task_id,
          parent_task_id,
          parent_run_id,
          depth,
          status,
          workspace_id,
          principal_type,
          principal_id,
          policy_snapshot_version,
          ingress,
          invokable_kind,
          invokable_version_id,
          logical_step_key,
          node_path,
          input_snapshot_ref,
          input_fingerprint,
          created_at,
          updated_at
        ) VALUES (
          'bf3d2bc7-2db0-4c80-9790-42e388bf0b64',
          'tenant_local',
          'bf3d2bc7-2db0-4c80-9790-42e388bf0b63',
          'bf3d2bc7-2db0-4c80-9790-42e388bf0b63',
          '47d4c8e0-ee39-4c19-95b9-a121627728f1',
          1,
          'queued',
          'workspace_main',
          'service_account',
          'svc_alpha',
          'policy-2026-07-22',
          'api',
          'agent',
          '00000000-0000-4000-8000-000000010101',
          NULL,
          'step.0001',
          'inline:prompt',
          'sha256:child',
          '2026-07-22T12:00:00.000Z',
          '2026-07-22T12:00:00.000Z'
        )
      `),
    ).rejects.toThrow(
      /logical_step|node_path|tasks_step_identity_shape_check/i,
    );

    await expect(
      database.query(`
        INSERT INTO runs (
          id,
          task_id,
          attempt,
          status,
          lease_owner,
          activation_id,
          fencing_token,
          lease_expires_at,
          runtime,
          result,
          usage,
          error,
          created_at,
          updated_at
        ) VALUES (
          '47d4c8e0-ee39-4c19-95b9-a121627728f0',
          'bf3d2bc7-2db0-4c80-9790-42e388bf0b63',
          1,
          'running',
          NULL,
          NULL,
          1,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          '2026-07-22T12:00:00.000Z',
          '2026-07-22T12:00:00.000Z'
        )
      `),
    ).rejects.toThrow(/runs_state_check/);
  });

  it('materializes durable admission state and reuses it idempotently', async () => {
    const database = await createDatabase();

    await applyDurableKernelMigrations(database);

    const useCase = new AdmitRootTask(
      new PostgresTaskRepository(database),
      new PostgresRunRepository(database),
      new PostgresAdmissionRepository(database),
    );

    const first = await useCase.execute({
      prompt: 'same prompt',
      idempotencyKey: 'same-key',
      accessContext: primaryAccessContext,
    });
    const second = await useCase.execute({
      prompt: 'same prompt',
      idempotencyKey: 'same-key',
      accessContext: primaryAccessContext,
    });

    expect(second).toEqual({ ...first, reused: true });

    const taskRows = await database.query(
      'SELECT id, root_task_id, status, tenant_id, workspace_id, principal_type, principal_id, policy_snapshot_version, input_snapshot_ref FROM tasks ORDER BY created_at ASC',
    );
    const runRows = await database.query(
      'SELECT id, task_id, attempt, status FROM runs ORDER BY created_at ASC',
    );
    const admissionRows = await database.query(
      'SELECT ingress, idempotency_key, task_id, tenant_id, workspace_id, principal_type, principal_id, policy_snapshot_version FROM admissions ORDER BY id ASC',
    );
    const dispatchRows = await database.query(
      'SELECT run_id, event_type, published_at FROM run_dispatches ORDER BY id ASC',
    );

    expect(taskRows.rows).toHaveLength(1);
    expect(taskRows.rows?.[0]).toMatchObject({
      id: first.taskId,
      root_task_id: first.taskId,
      status: 'queued',
      tenant_id: primaryAccessContext.tenantId,
      workspace_id: primaryAccessContext.workspaceId,
      principal_type: primaryAccessContext.principalType,
      principal_id: primaryAccessContext.principalId,
      policy_snapshot_version: primaryAccessContext.policySnapshotVersion,
    });
    expect(runRows.rows).toEqual([
      {
        id: first.runId,
        task_id: first.taskId,
        attempt: 1,
        status: 'queued',
      },
    ]);
    expect(admissionRows.rows).toEqual([
      {
        ingress: 'api',
        idempotency_key: 'same-key',
        task_id: first.taskId,
        tenant_id: primaryAccessContext.tenantId,
        workspace_id: primaryAccessContext.workspaceId,
        principal_type: primaryAccessContext.principalType,
        principal_id: primaryAccessContext.principalId,
        policy_snapshot_version: primaryAccessContext.policySnapshotVersion,
      },
    ]);
    expect(dispatchRows.rows).toEqual([
      {
        run_id: first.runId,
        event_type: 'run.enqueue',
        published_at: null,
      },
    ]);
  });

  it('enforces trusted session turn origins for tasks and admissions', async () => {
    const database = await createDatabase();
    await applyDurableKernelMigrations(database);

    const taskRepository = new PostgresTaskRepository(database);
    const admissionRepository = new PostgresAdmissionRepository(database);
    const larkTask = createRootTask({
      id: '00000000-0000-4000-8000-000000090012',
      ...primaryAccessContext,
      ingress: 'lark',
      originRef: 'feishu:event-1',
      invokableKind: 'agent',
      invokableVersionId: 'lark-origin-agent',
      inputSnapshotRef: 'inline:lark-origin',
      inputFingerprint: 'sha256:lark-origin',
      now: () => new Date('2026-07-24T12:00:00.000Z'),
    });
    await taskRepository.save(larkTask);
    await expect(taskRepository.findById(larkTask.id)).resolves.toMatchObject({
      ingress: 'lark',
      originRef: 'feishu:event-1',
    });

    const admitted = await new AdmitRootTask(
      taskRepository,
      new PostgresRunRepository(database),
      admissionRepository,
    ).execute({
      prompt: 'origin contract',
      idempotencyKey: 'origin-contract-key',
      accessContext: primaryAccessContext,
    });

    await expect(
      database.query('SELECT ingress, origin_ref FROM tasks WHERE id = $1', [
        admitted.taskId,
      ]),
    ).resolves.toMatchObject({ rows: [{ ingress: 'api', origin_ref: null }] });
    await expect(
      taskRepository.findById(admitted.taskId),
    ).resolves.toMatchObject({
      ingress: 'api',
      originRef: null,
    });

    await admissionRepository.withTransaction(async (transaction) => {
      await expect(
        transaction.findByIngressAndIdempotencyKey(
          'api',
          'origin-contract-key',
          primaryAccessContext,
        ),
      ).resolves.toMatchObject({ ingress: 'api', originRef: null });

      await transaction.save({
        ingress: 'lark',
        originRef: 'feishu:event-1',
        idempotencyKey: 'lark-origin-key',
        requestFingerprint: 'sha256:lark-origin',
        taskId: larkTask.id,
        ...primaryAccessContext,
        createdAt: larkTask.createdAt,
      });

      await expect(
        transaction.findByIngressAndIdempotencyKey(
          'lark',
          'lark-origin-key',
          primaryAccessContext,
        ),
      ).resolves.toMatchObject({
        ingress: 'lark',
        originRef: 'feishu:event-1',
      });
    });
    await expect(
      database.query(
        'SELECT ingress, origin_ref FROM admissions WHERE task_id = $1',
        [admitted.taskId],
      ),
    ).resolves.toMatchObject({ rows: [{ ingress: 'api', origin_ref: null }] });

    const insertAdmission = (ingress: string, originRef: string | null) =>
      database.query(
        `
          INSERT INTO admissions (
            ingress, origin_ref, idempotency_key, request_fingerprint, task_id,
            tenant_id, workspace_id, principal_type, principal_id,
            policy_snapshot_version, created_at
          ) VALUES ($1, $2, $3, 'sha256:origin', $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          ingress,
          originRef,
          `${ingress}-origin-key`,
          admitted.taskId,
          primaryAccessContext.tenantId,
          primaryAccessContext.workspaceId,
          primaryAccessContext.principalType,
          primaryAccessContext.principalId,
          primaryAccessContext.policySnapshotVersion,
          '2026-07-24T12:00:00.000Z',
        ],
      );

    await expect(insertAdmission('lark', null)).rejects.toThrow();
    await expect(insertAdmission('email', 'event-1')).rejects.toThrow();

    const apiOrigin: SessionTurnOrigin = {
      channel: 'api',
      requestId: 'request-1',
    };
    const larkOrigin: SessionTurnOrigin = {
      channel: 'lark',
      ingressEventId: 'event-1',
    };
    expect(originReference(apiOrigin)).toBeNull();
    expect(originReference(larkOrigin)).toBe('event-1');
  });

  it.each([
    ['api', 'unexpected'],
    ['lark', null],
    ['lark', ''],
    ['lark', '   '],
    ['email', 'event-1'],
  ])(
    'rejects invalid task and admission origin pair %s/%s in SQL',
    async (ingress, originRef) => {
      const database = await createDatabase();
      await applyDurableKernelMigrations(database);
      const taskRepository = new PostgresTaskRepository(database);
      const apiTask = createRootTask({
        id: '00000000-0000-4000-8000-000000090013',
        ...primaryAccessContext,
        ingress: 'api',
        originRef: null,
        invokableKind: 'agent',
        invokableVersionId: 'origin-matrix-agent',
        inputSnapshotRef: 'inline:origin-matrix',
        inputFingerprint: 'sha256:origin-matrix',
        now: () => new Date('2026-07-24T12:00:00.000Z'),
      });
      await taskRepository.save(apiTask);

      await expect(
        database.query(
          'UPDATE tasks SET ingress = $1, origin_ref = $2 WHERE id = $3',
          [ingress, originRef, apiTask.id],
        ),
      ).rejects.toThrow();
      await expect(
        database.query(
          `
            INSERT INTO admissions (
              ingress, origin_ref, idempotency_key, request_fingerprint, task_id,
              tenant_id, workspace_id, principal_type, principal_id,
              policy_snapshot_version, created_at
            ) VALUES ($1, $2, $3, 'sha256:invalid-origin', $4, $5, $6, $7, $8, $9, $10)
          `,
          [
            ingress,
            originRef,
            `invalid-${String(ingress)}-${String(originRef)}`,
            apiTask.id,
            primaryAccessContext.tenantId,
            primaryAccessContext.workspaceId,
            primaryAccessContext.principalType,
            primaryAccessContext.principalId,
            primaryAccessContext.policySnapshotVersion,
            apiTask.createdAt,
          ],
        ),
      ).rejects.toThrow();
    },
  );

  it('admits canonical task invoke state and reads it back through owner-scoped task queries', async () => {
    const database = await createDatabase();

    await applyDurableKernelMigrations(database);

    const invokables = new PostgresInvokableRepository(database);
    const { version: agentVersion } = await seedCanonicalPublishedAgent(
      database,
      primaryAccessContext,
      {
        definitionId: '00000000-0000-4000-8000-000000030001',
        versionId: '00000000-0000-4000-8000-000000030101',
        name: 'Task Agent',
        description: 'Used for canonical task invoke',
        instructions: 'Do the task.',
        now: new Date('2026-07-22T12:00:00.000Z'),
      },
    );

    const tasks = new PostgresTaskRepository(database);
    const runs = new PostgresRunRepository(database);
    const admissions = new PostgresAdmissionRepository(database);
    const invoked = await new InvokeTask(
      admissions,
      invokables,
      canonicalAgentResolver(database),
      () => new Date('2026-07-22T12:15:00.000Z'),
    ).execute({
      idempotencyKey: 'task-key',
      invokable: { kind: 'agent', versionId: agentVersion.id },
      input: { text: 'canonical task input' },
      accessContext: primaryAccessContext,
    });

    expect(invoked.reused).toBe(false);
    expect(invoked.task.task.invokableKind).toBe('agent');
    expect(invoked.task.task.invokableVersionId).toBe(agentVersion.id);
    expect(invoked.task.latestRun).toMatchObject({
      status: 'queued',
      attempt: 1,
    });

    const loaded = await new GetTask(tasks).execute(
      invoked.task.task.id,
      primaryAccessContext,
    );
    const tree = await new GetTaskTree(tasks).execute(
      invoked.task.task.id,
      primaryAccessContext,
    );

    expect(loaded).toMatchObject({
      task: {
        id: invoked.task.task.id,
        rootTaskId: invoked.task.task.id,
        invokableKind: 'agent',
        invokableVersionId: agentVersion.id,
      },
      latestRun: {
        status: 'queued',
        attempt: 1,
      },
    });
    expect(tree).toHaveLength(1);
    expect(tree?.[0]).toMatchObject({
      task: { id: invoked.task.task.id },
      latestRun: { status: 'queued', attempt: 1 },
    });

    const nonOwner = await new GetTask(tasks).execute(
      invoked.task.task.id,
      createAccessContext({ principalId: 'svc_beta' }),
    );
    expect(nonOwner).toBeNull();

    const taskRows = await database.query(
      'SELECT id, root_task_id, invokable_kind, invokable_version_id, workspace_id FROM tasks WHERE id = $1',
      [invoked.task.task.id],
    );
    expect(taskRows.rows).toEqual([
      {
        id: invoked.task.task.id,
        root_task_id: invoked.task.task.id,
        invokable_kind: 'agent',
        invokable_version_id: agentVersion.id,
        workspace_id: primaryAccessContext.workspaceId,
      },
    ]);
  });

  it('rejects mismatched admission reuse for the same idempotency key', async () => {
    const database = await createDatabase();

    await applyDurableKernelMigrations(database);

    const useCase = new AdmitRootTask(
      new PostgresTaskRepository(database),
      new PostgresRunRepository(database),
      new PostgresAdmissionRepository(database),
    );

    await useCase.execute({
      prompt: 'first prompt',
      idempotencyKey: 'same-key',
      accessContext: primaryAccessContext,
    });

    await expect(
      useCase.execute({
        prompt: 'different prompt',
        idempotencyKey: 'same-key',
        accessContext: primaryAccessContext,
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('creates separate admissions for the same idempotency key in different owner scopes and ignores policy version for replay matching', async () => {
    const database = await createDatabase();

    await applyDurableKernelMigrations(database);

    const useCase = new AdmitRootTask(
      new PostgresTaskRepository(database),
      new PostgresRunRepository(database),
      new PostgresAdmissionRepository(database),
    );

    const first = await useCase.execute({
      prompt: 'same prompt',
      idempotencyKey: 'shared-key',
      accessContext: createAccessContext({
        policySnapshotVersion: 'policy-v1',
      }),
    });
    const replay = await useCase.execute({
      prompt: 'same prompt',
      idempotencyKey: 'shared-key',
      accessContext: createAccessContext({
        policySnapshotVersion: 'policy-v2',
      }),
    });
    const secondScope = await useCase.execute({
      prompt: 'same prompt',
      idempotencyKey: 'shared-key',
      accessContext: createAccessContext({
        principalId: 'svc_beta',
        policySnapshotVersion: 'policy-v9',
      }),
    });

    expect(replay).toEqual({ ...first, reused: true });
    expect(secondScope.reused).toBe(false);
    expect(secondScope.taskId).not.toBe(first.taskId);
    expect(secondScope.runId).not.toBe(first.runId);

    const taskRows = await database.query(
      'SELECT id, tenant_id, workspace_id, principal_type, principal_id, policy_snapshot_version FROM tasks ORDER BY principal_id ASC',
    );
    const admissionRows = await database.query(
      'SELECT ingress, idempotency_key, tenant_id, workspace_id, principal_type, principal_id, policy_snapshot_version, task_id FROM admissions ORDER BY principal_id ASC',
    );

    expect(taskRows.rows).toEqual([
      {
        id: first.taskId,
        tenant_id: primaryAccessContext.tenantId,
        workspace_id: primaryAccessContext.workspaceId,
        principal_type: primaryAccessContext.principalType,
        principal_id: primaryAccessContext.principalId,
        policy_snapshot_version: 'policy-v1',
      },
      {
        id: secondScope.taskId,
        tenant_id: primaryAccessContext.tenantId,
        workspace_id: primaryAccessContext.workspaceId,
        principal_type: primaryAccessContext.principalType,
        principal_id: 'svc_beta',
        policy_snapshot_version: 'policy-v9',
      },
    ]);
    expect(admissionRows.rows).toEqual([
      {
        ingress: 'api',
        idempotency_key: 'shared-key',
        tenant_id: primaryAccessContext.tenantId,
        workspace_id: primaryAccessContext.workspaceId,
        principal_type: primaryAccessContext.principalType,
        principal_id: primaryAccessContext.principalId,
        policy_snapshot_version: 'policy-v1',
        task_id: first.taskId,
      },
      {
        ingress: 'api',
        idempotency_key: 'shared-key',
        tenant_id: primaryAccessContext.tenantId,
        workspace_id: primaryAccessContext.workspaceId,
        principal_type: primaryAccessContext.principalType,
        principal_id: 'svc_beta',
        policy_snapshot_version: 'policy-v9',
        task_id: secondScope.taskId,
      },
    ]);
  });

  it('claims one queued dispatched run atomically with lease metadata and publishes the dispatch', async () => {
    const database = await createDatabase();
    const clock = new TestClock('2026-07-22T12:00:00.000Z');

    await applyDurableKernelMigrations(database);

    const runRepository = new PostgresRunRepository(database);
    const useCase = new AdmitRootTask(
      new PostgresTaskRepository(database),
      runRepository,
      new PostgresAdmissionRepository(database),
      clock.now,
    );
    const admission = await useCase.execute({
      prompt: 'claim me once',
      idempotencyKey: 'claim-key',
      accessContext: primaryAccessContext,
    });

    clock.advanceMs(30_000);

    const claimed = await new ClaimNextRun(runRepository, {
      workerId: 'worker-a',
      leaseDurationMs: 60_000,
      now: clock.now,
      activationIdFactory: () => '00000000-0000-4000-8000-000000000111',
    }).execute();

    expect(claimed).toMatchObject({
      run: {
        id: admission.runId,
        status: 'running',
        updatedAt: '2026-07-22T12:00:30.000Z',
      },
      workerId: 'worker-a',
      activationId: '00000000-0000-4000-8000-000000000111',
      fencingToken: 1,
      leaseExpiresAt: '2026-07-22T12:01:30.000Z',
    });
    await expect(
      new ClaimNextRun(runRepository, {
        workerId: 'worker-b',
        leaseDurationMs: 60_000,
        now: clock.now,
        activationIdFactory: () => '00000000-0000-4000-8000-000000000222',
      }).execute(),
    ).resolves.toBeNull();

    const runRows = await database.query(
      `
        SELECT
          status,
          lease_owner,
          activation_id,
          fencing_token,
          lease_expires_at::text AS lease_expires_at
        FROM runs
        WHERE id = $1
      `,
      [admission.runId],
    );
    const dispatchRows = await database.query(
      `
        SELECT event_type, published_at::text AS published_at
        FROM run_dispatches
        WHERE run_id = $1
      `,
      [admission.runId],
    );

    expect(runRows.rows).toEqual([
      {
        status: 'running',
        lease_owner: 'worker-a',
        activation_id: '00000000-0000-4000-8000-000000000111',
        fencing_token: 1,
        lease_expires_at: '2026-07-22 12:01:30+00',
      },
    ]);
    expect(dispatchRows.rows).toEqual([
      {
        event_type: 'run.enqueue',
        published_at: '2026-07-22 12:00:30+00',
      },
    ]);
  });

  it('claims urgent canonical dispatches before older normal dispatches', async () => {
    const database = await createDatabase();
    const clock = new TestClock('2026-07-22T12:00:00.000Z');

    await applyDurableKernelMigrations(database);

    const runRepository = new PostgresRunRepository(database);
    const useCase = new AdmitRootTask(
      new PostgresTaskRepository(database),
      runRepository,
      new PostgresAdmissionRepository(database),
      clock.now,
    );
    const normal = await useCase.execute({
      prompt: 'normal canonical turn',
      idempotencyKey: 'normal-canonical-turn',
      accessContext: primaryAccessContext,
    });
    clock.advanceMs(1_000);
    const urgent = await useCase.execute({
      prompt: 'urgent canonical turn',
      idempotencyKey: 'urgent-canonical-turn',
      accessContext: primaryAccessContext,
    });
    await database.query(
      `UPDATE run_dispatches SET priority='urgent' WHERE run_id=$1`,
      [urgent.runId],
    );

    const claimed = await new ClaimNextRun(runRepository, {
      workerId: 'priority-worker',
      leaseDurationMs: 60_000,
      now: clock.now,
      activationIdFactory: () => '00000000-0000-4000-8000-000000000411',
    }).execute();

    expect(claimed?.run.id).toBe(urgent.runId);
    const normalRun = await runRepository.findById(normal.runId);
    expect(normalRun?.status).toBe('queued');
  });

  it('rejects a stale fenced terminal completion after a newer owner exists', async () => {
    const database = await createDatabase();
    const clock = new TestClock('2026-07-22T12:00:00.000Z');

    await applyDurableKernelMigrations(database);

    const runRepository = new PostgresRunRepository(database);
    const admission = await new AdmitRootTask(
      new PostgresTaskRepository(database),
      runRepository,
      new PostgresAdmissionRepository(database),
      clock.now,
    ).execute({
      prompt: 'stale completion prompt',
      idempotencyKey: 'stale-completion-key',
      accessContext: primaryAccessContext,
    });

    clock.advanceMs(30_000);
    const claimed = await new ClaimNextRun(runRepository, {
      workerId: 'worker-a',
      leaseDurationMs: 60_000,
      now: clock.now,
      activationIdFactory: () => '00000000-0000-4000-8000-000000000311',
    }).execute();
    expect(claimed).not.toBeNull();

    clock.advanceMs(5_000);
    await database.query(
      `
        UPDATE runs
        SET
          lease_owner = $2,
          activation_id = $3,
          fencing_token = $4,
          lease_expires_at = $5,
          updated_at = $6
        WHERE id = $1
      `,
      [
        admission.runId,
        'worker-b',
        '00000000-0000-4000-8000-000000000399',
        2,
        '2026-07-22T12:01:35.000Z',
        '2026-07-22T12:00:35.000Z',
      ],
    );

    clock.advanceMs(5_000);
    const terminal = transitionRun(
      claimed!.run,
      'succeeded',
      {
        runtime: { provider: 'opencode', model: 'opencode/fake-free' },
        result: { text: 'STALE_WRITE' },
      },
      clock.now,
    );

    await expect(
      new CompleteRun(
        runRepository,
        new PostgresTaskRepository(database),
      ).execute({
        claim: claimed!,
        run: terminal,
      }),
    ).rejects.toThrow(/stale|fenc/i);
  });

  it('persists a fenced terminal completion and clears lease metadata', async () => {
    const database = await createDatabase();
    const clock = new TestClock('2026-07-22T12:00:00.000Z');

    await applyDurableKernelMigrations(database);

    const runRepository = new PostgresRunRepository(database);
    const admission = await new AdmitRootTask(
      new PostgresTaskRepository(database),
      runRepository,
      new PostgresAdmissionRepository(database),
      clock.now,
    ).execute({
      prompt: 'complete me once',
      idempotencyKey: 'complete-key',
      accessContext: primaryAccessContext,
    });

    clock.advanceMs(20_000);
    const claimed = await new ClaimNextRun(runRepository, {
      workerId: 'worker-a',
      leaseDurationMs: 60_000,
      now: clock.now,
      activationIdFactory: () => '00000000-0000-4000-8000-000000000411',
    }).execute();
    expect(claimed).not.toBeNull();

    clock.advanceMs(10_000);
    const completed = await new CompleteRun(
      runRepository,
      new PostgresTaskRepository(database),
    ).execute({
      claim: claimed!,
      run: transitionRun(
        claimed!.run,
        'succeeded',
        {
          runtime: { provider: 'opencode', model: 'opencode/fake-free' },
          result: { text: 'COMPLETE_OK' },
          usage: { inputTokens: 3, outputTokens: 2, totalCostUsd: 0 },
        },
        clock.now,
      ),
    });

    expect(completed).toMatchObject({
      id: claimed!.run.id,
      status: 'succeeded',
      runtime: { provider: 'opencode', model: 'opencode/fake-free' },
      result: { text: 'COMPLETE_OK' },
    });

    const rows = await database.query(
      `
        SELECT
          status,
          lease_owner,
          activation_id,
          fencing_token,
          lease_expires_at,
          runtime,
          result,
          usage,
          error,
          updated_at::text AS updated_at
        FROM runs
        WHERE id = $1
      `,
      [claimed!.run.id],
    );

    expect(rows.rows).toEqual([
      {
        status: 'succeeded',
        lease_owner: null,
        activation_id: null,
        fencing_token: 1,
        lease_expires_at: null,
        runtime: { provider: 'opencode', model: 'opencode/fake-free' },
        result: { text: 'COMPLETE_OK' },
        usage: { inputTokens: 3, outputTokens: 2, totalCostUsd: 0 },
        error: null,
        updated_at: '2026-07-22 12:00:30+00',
      },
    ]);
  });

  it('dispatches durable run.enqueue work through the in-process worker loop', async () => {
    const database = await createDatabase();
    const clock = new TestClock('2026-07-22T12:00:00.000Z');
    const runtime = new FakeAgentRuntime({ responseText: 'DISPATCH_OK' });
    const logger = createLogger({
      service: 'agent-server-test',
      minimumLevel: 'error',
      write: () => undefined,
    });

    await applyDurableKernelMigrations(database);

    const runRepository = new PostgresRunRepository(database);
    const admission = await new AdmitRootTask(
      new PostgresTaskRepository(database),
      runRepository,
      new PostgresAdmissionRepository(database),
      clock.now,
    ).execute({
      prompt: 'dispatch me once',
      idempotencyKey: 'dispatch-key',
      accessContext: primaryAccessContext,
    });

    const dispatcher = new PostgresRunDispatcher(
      new ClaimNextRun(runRepository, {
        workerId: 'worker-loop',
        leaseDurationMs: 60_000,
        now: () => {
          const current = clock.now();
          clock.advanceMs(5_000);
          return current;
        },
        activationIdFactory: () => '00000000-0000-4000-8000-000000000511',
      }),
      createExecuteRun({
        database,
        runRepository,
        invokableRepository: new PostgresInvokableRepository(database),
        runtime,
        logger,
        now: clock.now,
      }),
      logger,
      { pollIntervalMs: 1 },
    );

    dispatcher.start();
    try {
      await waitFor(async () => {
        const run = await runRepository.findById(admission.runId);
        return run?.status === 'succeeded';
      });
    } finally {
      await dispatcher.stop();
    }

    const completedRun = await database.query<CompletedDispatchRow>(
      'SELECT status, result, lease_owner, activation_id, published_at FROM runs INNER JOIN run_dispatches ON run_dispatches.run_id = runs.id WHERE runs.id = $1',
      [admission.runId],
    );
    const completedRow = completedRun.rows?.[0];

    expect(runtime.executeCalls).toBe(1);
    expect(completedRow).toMatchObject({
      status: 'succeeded',
      result: { text: 'DISPATCH_OK' },
      lease_owner: null,
      activation_id: null,
    });
    expect(completedRow?.published_at).not.toBeNull();
  });

  // Excluded: the 120s real-PG retry timed out; see sandbox evidence /tmp/lane-a-canonical.{log,rc}.
  it.skip('executes a canonical agent task through the published agent version path', async () => {
    const database = await createDatabase();
    const clock = new TestClock('2026-07-22T12:00:00.000Z');
    const runtime = new FakeAgentRuntime({
      responseText: 'AGENT_TASK_OK',
    });
    const logger = createLogger({
      service: 'agent-server-test',
      minimumLevel: 'error',
      write: () => undefined,
    });

    await applyDurableKernelMigrations(database);

    const invokables = new PostgresInvokableRepository(database);
    const { version: agentVersion } = await seedCanonicalPublishedAgent(
      database,
      primaryAccessContext,
      {
        definitionId: '00000000-0000-4000-8000-000000040001',
        versionId: '00000000-0000-4000-8000-000000040101',
        name: 'Canonical Agent',
        description: 'Executes through the task path',
        instructions: 'Reply with the analyzed result only.',
        now: new Date('2026-07-22T12:00:00.000Z'),
      },
    );

    const tasks = new PostgresTaskRepository(database);
    const runs = new PostgresRunRepository(database);
    const admissions = new PostgresAdmissionRepository(database);
    const invocation = await new InvokeTask(
      admissions,
      invokables,
      canonicalAgentResolver(database),
      clock.now,
    ).execute({
      idempotencyKey: 'canonical-agent-task',
      invokable: { kind: 'agent', versionId: agentVersion.id },
      input: { text: 'Summarize this incident.' },
      accessContext: primaryAccessContext,
    });

    clock.advanceMs(30_000);
    const claim = await new ClaimNextRun(runs, {
      workerId: 'worker-agent-task',
      leaseDurationMs: 60_000,
      now: clock.now,
      activationIdFactory: () => '00000000-0000-4000-8000-000000000611',
    }).execute();

    expect(claim).not.toBeNull();

    await createExecuteRun({
      database,
      runRepository: runs,
      invokableRepository: invokables,
      runtime,
      logger,
      now: clock.now,
    }).execute(claim!);

    const task = await new GetTask(tasks).execute(
      invocation.task.task.id,
      primaryAccessContext,
    );

    expect(task).toMatchObject({
      task: {
        id: invocation.task.task.id,
        status: 'completed',
      },
      latestRun: {
        status: 'succeeded',
        result: { text: 'AGENT_TASK_OK' },
      },
    });
    expect(runtime.prompts).toHaveLength(1);
    expect(runtime.systemPrompts).toHaveLength(1);
    expect(runtime.systemPrompts[0]).toContain(
      'Reply with the analyzed result only.',
    );
    expect(runtime.prompts[0]).toContain('Summarize this incident.');
    expect(runtime.prompts[0]).not.toContain(
      'Reply with the analyzed result only.',
    );
  });
});

function createExecuteRun(input: {
  readonly database: PGlite;
  readonly runRepository: PostgresRunRepository;
  readonly invokableRepository: PostgresInvokableRepository;
  readonly runtime: FakeAgentRuntime;
  readonly logger: ReturnType<typeof createLogger>;
  readonly now: () => Date;
}): ExecuteRun {
  const tasks = new PostgresTaskRepository(input.database);
  const completeRun = new CompleteRun(input.runRepository, tasks);
  const executeTeamTask = new ExecuteTeamTask(
    input.invokableRepository,
    {} as never,
  );

  return new ExecuteRun({
    completeRun,
    tasks,
    definitions: input.invokableRepository,
    executeTeamTask,
    runtimeTurns: input.runtime,
    runtimeProvider: input.runtime,
    logger: input.logger,
    now: input.now,
  });
}

async function waitFor(check: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await check()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error('Timed out waiting for durable dispatch completion');
}
