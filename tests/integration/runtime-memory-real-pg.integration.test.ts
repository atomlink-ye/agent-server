import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createMemoryProposal } from '../../src/domain/workspace-memory/memory-proposal.js';
import { PostgresWorkspaceMemoryRepository } from '../../src/infrastructure/postgres/postgres-workspace-memory-repository.js';
import {
  applyDurableKernelMigrations,
  createPostgresPool,
  resolveDurableKernelMigrationFilePath,
} from '../../src/infrastructure/postgres/postgres.js';

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
const required = process.env.REAL_POSTGRES_REQUIRED === '1';
if (required && !connectionString) throw new Error('DATABASE_URL is required');
const describeReal = connectionString ? describe : describe.skip;

describeReal('real PostgreSQL runtime memory replay', () => {
  const pool = connectionString
    ? createPostgresPool({ connectionString, maxConnections: 4 })
    : null;
  const owner = {
    tenantId: `memory_replay_${randomUUID()}`,
    workspaceId: randomUUID(),
    principalType: 'service_account',
    principalId: 'memory-replay-owner',
  };
  const ids = {
    session: randomUUID(),
    message: randomUUID(),
    task: randomUUID(),
    run: randomUUID(),
    definition: randomUUID(),
    version: randomUUID(),
    alternateTask: randomUUID(),
    alternateMessage: randomUUID(),
    alternateRun: randomUUID(),
    alternateDefinition: randomUUID(),
    alternateVersion: randomUUID(),
  };

  beforeAll(async () => {
    if (!pool) return;
    await applyDurableKernelMigrations(pool);
    await pool.query(
      `INSERT INTO workspaces(id,tenant_id,principal_type,principal_id,name,created_at,updated_at) VALUES ($1,$2,$3,$4,'Replay workspace',now(),now())`,
      [
        owner.workspaceId,
        owner.tenantId,
        owner.principalType,
        owner.principalId,
      ],
    );
    await pool.query(
      `INSERT INTO product_sessions(id,workspace_id,tenant_id,principal_type,principal_id,published_agent_version_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,'legacy',now(),now())`,
      [
        ids.session,
        owner.workspaceId,
        owner.tenantId,
        owner.principalType,
        owner.principalId,
      ],
    );
    await pool.query(
      `INSERT INTO agent_definitions(id,tenant_id,workspace_id,principal_type,principal_id,name,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,'Replay agent',now(),now())`,
      [
        ids.definition,
        owner.tenantId,
        owner.workspaceId,
        owner.principalType,
        owner.principalId,
      ],
    );
    await pool.query(
      `INSERT INTO agent_versions(id,definition_id,tenant_id,workspace_id,principal_type,principal_id,status,name,instructions,created_at,updated_at,published_at) VALUES ($1,$2,$3,$4,$5,$6,'published','Replay version','instructions',now(),now(),now())`,
      [
        ids.version,
        ids.definition,
        owner.tenantId,
        owner.workspaceId,
        owner.principalType,
        owner.principalId,
      ],
    );
    await pool.query(
      `INSERT INTO tasks(id,tenant_id,workspace_id,principal_type,principal_id,policy_snapshot_version,root_task_id,depth,status,ingress,invokable_kind,invokable_version_id,input_snapshot_ref,input_fingerprint,session_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,'policy',$1,0,'active','api','agent',$6,'ref','fingerprint',$7,now(),now())`,
      [
        ids.task,
        owner.tenantId,
        owner.workspaceId,
        owner.principalType,
        owner.principalId,
        ids.version,
        ids.session,
      ],
    );
    await pool.query(
      `INSERT INTO messages(id,session_id,generation,sequence,role,text,task_id,created_at) VALUES ($1,$2,0,1,'user','input',$3,now())`,
      [ids.message, ids.session, ids.task],
    );
    await pool.query(
      `INSERT INTO runs(id,task_id,attempt,status,lease_owner,activation_id,lease_expires_at,fencing_token,result,created_at,updated_at) VALUES ($1,$2,1,'succeeded',NULL,NULL,NULL,1,'{"text":"done"}',now(),now())`,
      [ids.run, ids.task],
    );
    await pool.query(
      `INSERT INTO agent_definitions(id,tenant_id,workspace_id,principal_type,principal_id,name,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,'Alternate agent',now(),now())`,
      [
        ids.alternateDefinition,
        owner.tenantId,
        owner.workspaceId,
        owner.principalType,
        owner.principalId,
      ],
    );
    await pool.query(
      `INSERT INTO agent_versions(id,definition_id,tenant_id,workspace_id,principal_type,principal_id,status,name,instructions,created_at,updated_at,published_at) VALUES ($1,$2,$3,$4,$5,$6,'published','Alternate version','instructions',now(),now(),now())`,
      [
        ids.alternateVersion,
        ids.alternateDefinition,
        owner.tenantId,
        owner.workspaceId,
        owner.principalType,
        owner.principalId,
      ],
    );
    await pool.query(
      `INSERT INTO tasks(id,tenant_id,workspace_id,principal_type,principal_id,policy_snapshot_version,root_task_id,depth,status,ingress,invokable_kind,invokable_version_id,input_snapshot_ref,input_fingerprint,session_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,'policy',$1,0,'active','api','agent',$6,'ref','alternate-fingerprint',$7,now(),now())`,
      [
        ids.alternateTask,
        owner.tenantId,
        owner.workspaceId,
        owner.principalType,
        owner.principalId,
        ids.version,
        ids.session,
      ],
    );
    await pool.query(
      `INSERT INTO messages(id,session_id,generation,sequence,role,text,task_id,created_at) VALUES ($1,$2,0,2,'user','alternate input',$3,now())`,
      [ids.alternateMessage, ids.session, ids.alternateTask],
    );
    await pool.query(
      `INSERT INTO runs(id,task_id,attempt,status,lease_owner,activation_id,lease_expires_at,fencing_token,created_at,updated_at) VALUES ($1,$2,1,'running','worker',$3,now()+interval '1 hour',1,now(),now())`,
      [ids.alternateRun, ids.alternateTask, randomUUID()],
    );
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(
      'DELETE FROM workspace_memory_proposals WHERE tenant_id=$1',
      [owner.tenantId],
    );
    await pool.query('DELETE FROM runs WHERE id=$1', [ids.run]);
    await pool.query('DELETE FROM runs WHERE id=$1', [ids.alternateRun]);
    await pool.query('DELETE FROM messages WHERE id=$1', [ids.message]);
    await pool.query('DELETE FROM messages WHERE id=$1', [
      ids.alternateMessage,
    ]);
    await pool.query('DELETE FROM tasks WHERE id=$1', [ids.task]);
    await pool.query('DELETE FROM tasks WHERE id=$1', [ids.alternateTask]);
    await pool.query('DELETE FROM agent_versions WHERE id=$1', [ids.version]);
    await pool.query('DELETE FROM agent_versions WHERE id=$1', [
      ids.alternateVersion,
    ]);
    await pool.query('DELETE FROM agent_definitions WHERE id=$1', [
      ids.definition,
    ]);
    await pool.query('DELETE FROM agent_definitions WHERE id=$1', [
      ids.alternateDefinition,
    ]);
    await pool.query('DELETE FROM product_sessions WHERE id=$1', [ids.session]);
    await pool.query('DELETE FROM workspaces WHERE id=$1', [owner.workspaceId]);
    await pool.end();
  });

  it('returns one canonical proposal for concurrent same-run/index inserts', async () => {
    if (!pool) return;
    const proposal = (id: string) =>
      createMemoryProposal({
        ...owner,
        id,
        originalContent: 'canonical',
        originalCategory: 'project_constraint',
        sourceTaskId: ids.task,
        sourceMessageId: ids.message,
        sourceRunId: ids.run,
        sourceAgentVersionId: ids.version,
        sourceCandidateIndex: 0,
        proposerSnapshot: {
          principalType: owner.principalType,
          principalId: owner.principalId,
          policySnapshotVersion: 'policy',
        },
      });
    const [first, second] = await Promise.all([
      new PostgresWorkspaceMemoryRepository(pool).createProposalsBatch([
        proposal(randomUUID()),
      ]),
      new PostgresWorkspaceMemoryRepository(pool).createProposalsBatch([
        proposal(randomUUID()),
      ]),
    ]);
    expect(first[0]?.id).toBe(second[0]?.id);
    const rows = await pool.query(
      'SELECT id FROM workspace_memory_proposals WHERE source_run_id=$1 AND source_candidate_index=0',
      [ids.run],
    );
    expect(rows.rows).toHaveLength(1);
  });

  it('enforces every runtime relationship and authoritative Workspace owner on insert/update', async () => {
    if (!pool) return;
    const repository = new PostgresWorkspaceMemoryRepository(pool);
    const makeProposal = (overrides: Record<string, string | number> = {}) =>
      createMemoryProposal({
        ...owner,
        id: randomUUID(),
        originalContent: 'integrity case',
        originalCategory: 'project_constraint',
        sourceTaskId: ids.task,
        sourceMessageId: ids.message,
        sourceRunId: ids.run,
        sourceAgentVersionId: ids.version,
        sourceCandidateIndex: 0,
        ...overrides,
        proposerSnapshot: {
          principalType: owner.principalType,
          principalId: owner.principalId,
          policySnapshotVersion: 'policy',
        },
      });

    await expect(
      repository.createProposalsBatch([
        makeProposal({ sourceCandidateIndex: 5 }),
      ]),
    ).resolves.toHaveLength(1);
    const updateId = randomUUID();
    await repository.createProposalsBatch([
      makeProposal({ id: updateId, sourceCandidateIndex: 1 }),
    ]);
    await expect(
      pool.query(
        'UPDATE workspace_memory_proposals SET source_message_id=$1 WHERE id=$2',
        [ids.alternateMessage, updateId],
      ),
    ).rejects.toThrow(/provenance/i);

    const mismatches: Array<[string, string]> = [
      ['sourceTaskId', ids.alternateTask],
      ['sourceRunId', ids.alternateRun],
      ['sourceAgentVersionId', ids.alternateVersion],
    ];
    for (const [index, [field, value]] of mismatches.entries()) {
      await expect(
        repository.createProposalsBatch([
          makeProposal({ [field]: value, sourceCandidateIndex: index + 2 }),
        ]),
      ).rejects.toThrow(/provenance/i);
    }

    await pool.query('UPDATE workspaces SET tenant_id=$1 WHERE id=$2', [
      'wrong-tenant',
      owner.workspaceId,
    ]);
    await expect(
      repository.createProposalsBatch([makeProposal()]),
    ).rejects.toThrow(/provenance/i);
    await pool.query('UPDATE workspaces SET tenant_id=$1 WHERE id=$2', [
      owner.tenantId,
      owner.workspaceId,
    ]);
  });

  it('replays migration 0011 and retains valid insert/update and update rejection', async () => {
    if (!pool) return;
    const repository = new PostgresWorkspaceMemoryRepository(pool);
    const id = randomUUID();
    const valid = createMemoryProposal({
      ...owner,
      id,
      originalContent: 'replayed integrity case',
      originalCategory: 'project_constraint',
      sourceTaskId: ids.task,
      sourceMessageId: ids.message,
      sourceRunId: ids.run,
      sourceAgentVersionId: ids.version,
      sourceCandidateIndex: 3,
      proposerSnapshot: {
        principalType: owner.principalType,
        principalId: owner.principalId,
        policySnapshotVersion: 'policy',
      },
    });
    await pool.query(
      `DELETE FROM durable_kernel_schema_migrations WHERE version='0011_runtime_memory_provenance_integrity'`,
    );
    await applyDurableKernelMigrations(pool, [
      resolveDurableKernelMigrationFilePath(
        '0011_runtime_memory_provenance_integrity.sql',
      ),
    ]);
    await expect(
      repository.createProposalsBatch([valid]),
    ).resolves.toHaveLength(1);
    await expect(
      pool.query(
        'UPDATE workspace_memory_proposals SET source_run_id=$1 WHERE id=$2',
        [ids.alternateRun, id],
      ),
    ).rejects.toThrow(/provenance/i);
  });
});
