import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { createMemoryProposal } from '../../src/domain/workspace-memory/memory-proposal.js';
import { CreateMemoryProposal } from '../../src/application/memory/create-memory-proposal.js';
import {
  applyDurableKernelMigrations,
  resolveDurableKernelMigrationFilePath,
} from '../../src/infrastructure/postgres/postgres.js';
import { PostgresWorkspaceMemoryRepository } from '../../src/infrastructure/postgres/postgres-workspace-memory-repository.js';
import { PostgresTaskRepository } from '../../src/infrastructure/postgres/postgres-task-repository.js';

const owner = {
  tenantId: 'tenant-1',
  workspaceId: '00000000-0000-4000-8000-000000000901',
  principalType: 'service_account',
  principalId: 'svc-1',
};
const actor = {
  principalType: 'service_account',
  principalId: 'svc-1',
  policySnapshotVersion: 'policy-1',
};
const runtimeAgentVersionId = '00000000-0000-4000-8000-000000000904';
const runtimeTaskId = '00000000-0000-4000-8000-000000000101';
const runtimeMessageId = '00000000-0000-4000-8000-000000000903';
const runtimeRunId = '00000000-0000-4000-8000-000000000201';

function proposal(
  id: string,
  runId: string,
  index: number,
  content = `memory-${index}`,
) {
  return createMemoryProposal({
    ...owner,
    id,
    originalContent: content,
    originalCategory: 'project_constraint',
    sourceTaskId: runtimeTaskId,
    sourceMessageId: runtimeMessageId,
    sourceRunId: runId,
    sourceAgentVersionId: runtimeAgentVersionId,
    sourceCandidateIndex: index,
    proposerSnapshot: actor,
    now: () => new Date('2026-01-01T00:00:00Z'),
  });
}

async function database() {
  const db = new PGlite();
  await applyDurableKernelMigrations(db);
  await db.query(
    `INSERT INTO workspaces(id,tenant_id,principal_type,principal_id,name,created_at,updated_at) VALUES ('00000000-0000-4000-8000-000000000901','tenant-1','service_account','svc-1','Workspace',now(),now())`,
  );
  await db.query(
    `INSERT INTO product_sessions(id,workspace_id,tenant_id,principal_type,principal_id,published_agent_version_id,created_at,updated_at) VALUES ('00000000-0000-4000-8000-000000000902','00000000-0000-4000-8000-000000000901','tenant-1','service_account','svc-1','legacy',now(),now())`,
  );
  await db.query(
    `INSERT INTO agent_definitions(id,tenant_id,workspace_id,principal_type,principal_id,name,created_at,updated_at) VALUES ('00000000-0000-4000-8000-000000000905','tenant-1','00000000-0000-4000-8000-000000000901','service_account','svc-1','Runtime agent',now(),now())`,
  );
  await db.query(
    `INSERT INTO agent_versions(id,definition_id,tenant_id,workspace_id,principal_type,principal_id,status,name,instructions,created_at,updated_at,published_at) VALUES ('${runtimeAgentVersionId}','00000000-0000-4000-8000-000000000905','tenant-1','00000000-0000-4000-8000-000000000901','service_account','svc-1','published','Runtime version','instructions',now(),now(),now())`,
  );
  await db.query(
    `INSERT INTO tasks(id,tenant_id,workspace_id,principal_type,principal_id,policy_snapshot_version,root_task_id,depth,status,ingress,invokable_kind,invokable_version_id,input_snapshot_ref,input_fingerprint,session_id,created_at,updated_at) VALUES ('00000000-0000-4000-8000-000000000101','tenant-1','00000000-0000-4000-8000-000000000901','service_account','svc-1','policy-1','00000000-0000-4000-8000-000000000101',0,'active','api','agent','${runtimeAgentVersionId}','ref','fingerprint','00000000-0000-4000-8000-000000000902',now(),now())`,
  );
  await db.query(
    `INSERT INTO messages(id,session_id,generation,sequence,role,text,task_id,created_at) VALUES ('00000000-0000-4000-8000-000000000903','00000000-0000-4000-8000-000000000902',0,1,'user','input','00000000-0000-4000-8000-000000000101',now())`,
  );
  await db.query(
    `INSERT INTO runs(id,task_id,attempt,status,lease_owner,activation_id,lease_expires_at,fencing_token,created_at,updated_at) VALUES ('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000101',1,'running','worker','00000000-0000-4000-8000-000000000301',now()+interval '1 hour',1,now(),now())`,
  );
  return db;
}

describe('runtime memory PostgreSQL materialization', () => {
  it('lists only pending proposals for the exact successful source run and owner', async () => {
    const db = await database();
    await db.query(
      `UPDATE runs SET status='succeeded', lease_owner=NULL, activation_id=NULL, lease_expires_at=NULL, result='{"text":"done"}' WHERE id='${runtimeRunId}'`,
    );
    const repository = new PostgresWorkspaceMemoryRepository(db);
    await repository.createProposal(
      proposal('00000000-0000-4000-8000-000000000601', runtimeRunId, 0),
    );
    const rejected = await repository.createProposal(
      proposal('00000000-0000-4000-8000-000000000602', runtimeRunId, 1),
    );
    await repository.reviewProposal({
      proposalId: rejected.id,
      ownerScope: owner,
      outcome: 'reject',
      reviewerSnapshot: actor,
    });
    const pending = await repository.listPendingProposalsBySourceRunForOwner(
      runtimeRunId,
      owner,
    );
    expect(pending.map(({ id }) => id)).toEqual([
      '00000000-0000-4000-8000-000000000601',
    ]);
    expect(
      await repository.listPendingProposalsBySourceRunForOwner(runtimeRunId, {
        ...owner,
        principalId: 'foreign-owner',
      }),
    ).toEqual([]);
  });

  it('derives exact input Message provenance after durable Task reload', async () => {
    const db = await database();
    const task = await new PostgresTaskRepository(db).findById(
      '00000000-0000-4000-8000-000000000101',
    );
    expect(task?.sourceMessageId).toBe('00000000-0000-4000-8000-000000000903');
    await db.query(
      `UPDATE runs SET status='succeeded', lease_owner=NULL, activation_id=NULL, lease_expires_at=NULL, result='{"text":"done"}' WHERE id='00000000-0000-4000-8000-000000000201'`,
    );
    const repository = new PostgresWorkspaceMemoryRepository(db);
    await new CreateMemoryProposal(
      repository,
      new PostgresTaskRepository(db),
    ).execute({
      content: 'derived from message',
      category: 'project_constraint',
      sourceTaskId: task!.id,
      sourceMessageId: runtimeMessageId,
      sourceRunId: runtimeRunId,
      sourceAgentVersionId: runtimeAgentVersionId,
      sourceCandidateIndex: 0,
      accessContext: {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        principalType: 'service_account',
        principalId: 'svc-1',
        serviceAccountId: 'svc-1',
        policySnapshotVersion: 'policy-1',
      },
    });
    const row = await db.query<{ source_message_id: string }>(
      'SELECT source_message_id FROM workspace_memory_proposals',
    );
    expect(row.rows).toEqual([
      { source_message_id: '00000000-0000-4000-8000-000000000903' },
    ]);
  });

  it('is transactional, replay-idempotent, and hidden until source run succeeds', async () => {
    const db = await database();
    const index = await db.query(
      `SELECT indexname FROM pg_indexes WHERE indexname='workspace_memory_proposals_runtime_replay'`,
    );
    expect(index.rows).toEqual([
      { indexname: 'workspace_memory_proposals_runtime_replay' },
    ]);
    const repository = new PostgresWorkspaceMemoryRepository(db);
    const runId = runtimeRunId;
    const first = proposal('00000000-0000-4000-8000-000000000401', runId, 0);
    const second = proposal('00000000-0000-4000-8000-000000000402', runId, 1);
    await expect(
      repository.createProposalsBatch([first, second]),
    ).resolves.toHaveLength(2);
    await expect(
      repository.createProposalsBatch([
        proposal('00000000-0000-4000-8000-000000000499', runId, 0, 'changed'),
      ]),
    ).resolves.toEqual([first]);
    await expect(
      repository.findProposalByIdForOwner(first.id, owner),
    ).resolves.toBeNull();
    await expect(
      repository.reviewProposal({
        proposalId: first.id,
        ownerScope: owner,
        outcome: 'accept',
        reviewerSnapshot: actor,
      }),
    ).rejects.toThrow(/not found/i);
    expect(await repository.listProposalsByOwnerScope(owner)).toHaveLength(0);
    await db.query(
      `UPDATE runs SET status='succeeded', lease_owner=NULL, activation_id=NULL, lease_expires_at=NULL, result='{"text":"done"}' WHERE id=$1`,
      [runId],
    );
    expect(await repository.listProposalsByOwnerScope(owner)).toHaveLength(2);
    const indexes = await db.query(
      `SELECT source_candidate_index FROM workspace_memory_proposals WHERE source_run_id=$1 ORDER BY source_candidate_index`,
      [runId],
    );
    expect(indexes.rows).toEqual([
      { source_candidate_index: 0 },
      { source_candidate_index: 1 },
    ]);
    const accepted = await repository.reviewProposal({
      proposalId: first.id,
      ownerScope: owner,
      outcome: 'accept',
      reviewerSnapshot: actor,
      entryIdFactory: () => '00000000-0000-4000-8000-000000000499',
    });
    expect(accepted.entry).toMatchObject({
      id: '00000000-0000-4000-8000-000000000499',
      proposalId: first.id,
      sourceTaskId: runtimeTaskId,
      sourceMessageId: runtimeMessageId,
      sourceRunId: runId,
      sourceAgentVersionId: runtimeAgentVersionId,
      sourceCandidateIndex: 0,
    });
  });

  it('rolls back every candidate when a batch insert fails', async () => {
    const db = await database();
    const repository = new PostgresWorkspaceMemoryRepository(db);
    const runId = '00000000-0000-4000-8000-000000000201';
    const first = proposal('00000000-0000-4000-8000-000000000411', runId, 0);
    const duplicate = proposal(first.id, runId, 1);
    await expect(
      repository.createProposalsBatch([first, duplicate]),
    ).rejects.toThrow();
    const rows = await db.query('SELECT id FROM workspace_memory_proposals');
    expect(rows.rows).toHaveLength(0);
  });

  it.each([
    [
      'source Message belongs to source Task',
      'source_message_id',
      '00000000-0000-4000-8000-000000000906',
    ],
    [
      'proposal source Task matches Message and Run',
      'source_task_id',
      '00000000-0000-4000-8000-000000000908',
    ],
    [
      'source Run belongs to source Task',
      'source_run_id',
      '00000000-0000-4000-8000-000000000202',
    ],
    [
      'Task is pinned to source AgentVersion',
      'source_agent_version_id',
      '00000000-0000-4000-8000-000000000907',
    ],
    ['proposal tenant ownership', 'tenant_id', 'other-tenant'],
    ['proposal workspace ownership', 'workspace_id', 'other-workspace'],
    ['proposal principal type ownership', 'principal_type', 'user'],
    ['proposal principal id ownership', 'principal_id', 'other-principal'],
  ])(
    'rejects a runtime provenance tuple when %s mismatches',
    async (_label, column, value) => {
      const db = await database();
      await db.query(
        `INSERT INTO tasks(id,tenant_id,workspace_id,principal_type,principal_id,policy_snapshot_version,root_task_id,depth,status,ingress,invokable_kind,invokable_version_id,input_snapshot_ref,input_fingerprint,session_id,created_at,updated_at) VALUES ('00000000-0000-4000-8000-000000000908','tenant-1',$1,'service_account','svc-1','policy-1','00000000-0000-4000-8000-000000000908',0,'active','api','agent',$2,'ref','fingerprint','00000000-0000-4000-8000-000000000902',now(),now())`,
        [owner.workspaceId, runtimeAgentVersionId],
      );
      await db.query(
        `INSERT INTO messages(id,session_id,generation,sequence,role,text,task_id,created_at) VALUES ('00000000-0000-4000-8000-000000000906','00000000-0000-4000-8000-000000000902',0,2,'user','other input','00000000-0000-4000-8000-000000000908',now())`,
      );
      await db.query(
        `INSERT INTO runs(id,task_id,attempt,status,lease_owner,activation_id,lease_expires_at,fencing_token,created_at,updated_at) VALUES ('00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000908',1,'running','worker','00000000-0000-4000-8000-000000000302',now()+interval '1 hour',1,now(),now())`,
      );
      await db.query(
        `INSERT INTO agent_definitions(id,tenant_id,workspace_id,principal_type,principal_id,name,created_at,updated_at) VALUES ('00000000-0000-4000-8000-000000000910','tenant-1',$1,'service_account','svc-1','Other agent',now(),now())`,
        [owner.workspaceId],
      );
      await db.query(
        `INSERT INTO agent_versions(id,definition_id,tenant_id,workspace_id,principal_type,principal_id,status,name,instructions,created_at,updated_at,published_at) VALUES ('00000000-0000-4000-8000-000000000907','00000000-0000-4000-8000-000000000910','tenant-1',$1,'service_account','svc-1','published','Other version','instructions',now(),now(),now())`,
        [owner.workspaceId],
      );
      const id = '00000000-0000-4000-8000-000000000420';
      await new PostgresWorkspaceMemoryRepository(db).createProposalsBatch([
        proposal(id, runtimeRunId, 0),
      ]);
      await expect(
        db.query(
          `UPDATE workspace_memory_proposals SET ${column}=$1 WHERE id=$2`,
          [value, id],
        ),
      ).rejects.toThrow(/provenance/i);
      await db.close();
    },
  );

  it('accepts valid insert/update and direct migration replay reinstalls the trigger', async () => {
    const db = await database();
    await db.query(
      `INSERT INTO tasks(id,tenant_id,workspace_id,principal_type,principal_id,policy_snapshot_version,root_task_id,depth,status,ingress,invokable_kind,invokable_version_id,input_snapshot_ref,input_fingerprint,session_id,created_at,updated_at) VALUES ('00000000-0000-4000-8000-000000000908','tenant-1',$1,'service_account','svc-1','policy-1','00000000-0000-4000-8000-000000000908',0,'active','api','agent',$2,'ref','fingerprint','00000000-0000-4000-8000-000000000902',now(),now())`,
      [owner.workspaceId, runtimeAgentVersionId],
    );
    const repository = new PostgresWorkspaceMemoryRepository(db);
    const id = '00000000-0000-4000-8000-000000000430';
    await expect(
      repository.createProposalsBatch([proposal(id, runtimeRunId, 0)]),
    ).resolves.toHaveLength(1);
    await expect(
      db.query(
        `UPDATE workspace_memory_proposals SET original_content='updated' WHERE id=$1`,
        [id],
      ),
    ).resolves.toBeTruthy();
    await db.query(
      `DELETE FROM durable_kernel_schema_migrations WHERE version='0011_runtime_memory_provenance_integrity'`,
    );
    await applyDurableKernelMigrations(db, [
      resolveDurableKernelMigrationFilePath(
        '0011_runtime_memory_provenance_integrity.sql',
      ),
    ]);
    await expect(
      db.query(
        `UPDATE workspace_memory_proposals SET source_task_id='00000000-0000-4000-8000-000000000908' WHERE id=$1`,
        [id],
      ),
    ).rejects.toThrow(/provenance/i);
    await db.close();
  });
});
