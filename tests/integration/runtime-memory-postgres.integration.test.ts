import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { createMemoryProposal } from '../../src/domain/workspace-memory/memory-proposal.js';
import { applyDurableKernelMigrations } from '../../src/infrastructure/postgres/postgres.js';
import { PostgresWorkspaceMemoryRepository } from '../../src/infrastructure/postgres/postgres-workspace-memory-repository.js';

const owner = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  principalType: 'service_account',
  principalId: 'svc-1',
};
const actor = {
  principalType: 'service_account',
  principalId: 'svc-1',
  policySnapshotVersion: 'policy-1',
};

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
    sourceRunId: runId,
    sourceCandidateIndex: index,
    proposerSnapshot: actor,
    now: () => new Date('2026-01-01T00:00:00Z'),
  });
}

async function database() {
  const db = new PGlite();
  await applyDurableKernelMigrations(db);
  await db.query(
    `INSERT INTO tasks(id,tenant_id,workspace_id,principal_type,principal_id,policy_snapshot_version,root_task_id,depth,status,ingress,invokable_kind,invokable_version_id,input_snapshot_ref,input_fingerprint,created_at,updated_at) VALUES ('00000000-0000-4000-8000-000000000101','tenant-1','workspace-1','service_account','svc-1','policy-1','00000000-0000-4000-8000-000000000101',0,'active','api','agent','legacy','ref','fingerprint',now(),now())`,
  );
  await db.query(
    `INSERT INTO runs(id,task_id,attempt,status,lease_owner,activation_id,lease_expires_at,fencing_token,created_at,updated_at) VALUES ('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000101',1,'running','worker','00000000-0000-4000-8000-000000000301',now()+interval '1 hour',1,now(),now())`,
  );
  return db;
}

describe('runtime memory PostgreSQL materialization', () => {
  it('is transactional, replay-idempotent, and hidden until source run succeeds', async () => {
    const db = await database();
    const index = await db.query(
      `SELECT indexname FROM pg_indexes WHERE indexname='workspace_memory_proposals_runtime_replay'`,
    );
    expect(index.rows).toEqual([
      { indexname: 'workspace_memory_proposals_runtime_replay' },
    ]);
    const repository = new PostgresWorkspaceMemoryRepository(db);
    const runId = '00000000-0000-4000-8000-000000000201';
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
});
