import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';

import { ResolveWorkDefinition } from '../../src/application/work/resolve-work-definition.js';
import { StartWorkRun } from '../../src/application/work/start-work-run.js';
import { WorkIdentityApi } from '../../src/application/work/work-identity-api.js';
import { createProductProjection } from '../../src/application/product-projection/product-projection.js';
import { WorkProjectionFactsSource } from '../../src/application/product-projection/work-projection-facts-source.js';
import { fingerprintWorkDefinitionSource } from '../../src/domain/work/work-definition-source.js';
import { PostgresWorkDefinitionSourceRepository } from '../../src/infrastructure/postgres/postgres-work-definition-source-repository.js';
import { PostgresWorkProjectionFactsQuery } from '../../src/infrastructure/postgres/postgres-work-projection-facts-query.js';
import { PostgresWorkIdentityRepository } from '../../src/infrastructure/postgres/postgres-work-identity-repository.js';
import {
  applyDurableKernelMigrations,
  createPostgresPool,
} from '../../src/infrastructure/postgres/postgres.js';
import type { AccessContext } from '../../src/domain/access-context.js';

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!connectionString)
  throw new Error(
    'real PostgreSQL integration requires DATABASE_URL or POSTGRES_URL',
  );

const tenantId = 'composition_real_pg_tenant';
const workspaceId = 'a1111111-1111-4111-8111-111111111111';
const principalId = 'composition-real-pg';
const definitionId = randomUUID();
const definitionVersionId = randomUUID();
const agentVersionId = 'a4444444-4444-4444-8444-444444444444';
const environmentVersionId = 'a5555555-5555-4555-8555-555555555555';
const memoryVersionId = 'a6666666-6666-4666-8666-666666666666';
const at = '2026-08-16T00:00:00.000Z';

const access: AccessContext = {
  tenantId,
  workspaceId,
  principalType: 'service_account',
  principalId,
  policySnapshotVersion: 'composition-real-pg-v1',
};

describe('Composition-first Work on real PostgreSQL', () => {
  let pool: Pool;
  const createdTaskIds: string[] = [];
  const createdWorkIds: string[] = [];

  beforeAll(async () => {
    pool = createPostgresPool({
      connectionString: connectionString!,
      maxConnections: 2,
    });
    await applyDurableKernelMigrations(pool);
    await pool.query(
      `INSERT INTO workspaces
       (id,tenant_id,principal_type,principal_id,name,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$6)
       ON CONFLICT (id) DO UPDATE SET
         tenant_id=EXCLUDED.tenant_id,
         principal_type=EXCLUDED.principal_type,
         principal_id=EXCLUDED.principal_id,
         updated_at=EXCLUDED.updated_at`,
      [
        workspaceId,
        tenantId,
        access.principalType,
        principalId,
        'Composition Real PG',
        at,
      ],
    );
  });

  afterAll(async () => {
    if (createdWorkIds.length) {
      await pool.query(
        `DELETE FROM work_run_resource_manifest
          WHERE work_run_id IN (
            SELECT id FROM work_runs WHERE work_id = ANY($1::uuid[])
          )`,
        [createdWorkIds],
      );
      await pool.query(
        'DELETE FROM work_runs WHERE work_id = ANY($1::uuid[])',
        [createdWorkIds],
      );
      await pool.query('DELETE FROM works WHERE id = ANY($1::uuid[])', [
        createdWorkIds,
      ]);
    }
    if (createdTaskIds.length)
      await pool.query('DELETE FROM tasks WHERE id = ANY($1::uuid[])', [
        createdTaskIds,
      ]);
    await pool?.end();
  });

  it('publishes Definition intent, freezes exact resources, then admits the Worker', async () => {
    const sources = new PostgresWorkDefinitionSourceRepository(pool);
    const source = {
      kind: 'single_worker' as const,
      workerVersionId: agentVersionId,
      environmentVersionId,
      memoryVersionIds: [memoryVersionId],
    } as any;
    await sources.publish({
      definitionId,
      versionId: definitionVersionId,
      owner: {
        tenantId,
        workspaceId,
        principalType: access.principalType,
        principalId,
      },
      name: 'Composition Real PG Work',
      description: 'Worker + Environment + Memory + Skill + domain Tool',
      source,
      fingerprint: fingerprintWorkDefinitionSource(source),
      now: at,
    });

    const resolver = new ResolveWorkDefinition({
      workers: {
        findVersion: async (_owner: unknown, id: string) =>
          id === agentVersionId
            ? ({
                id,
                status: 'published',
                fingerprint: 'sha256:agent-version',
              } as any)
            : null,
      } as any,
      workerResolution: {
        resolvePublished: async (id: string) =>
          id === agentVersionId
            ? ({
                source: 'worker',
                id,
                definitionId,
                workerOwner: {} as any,
                instructions: 'research with pinned resources',
                modelPolicyRef: 'free-only',
                proposalLimit: 0,
                skills: [
                  {
                    ref: 'composition-research-skill',
                    digest: 'a'.repeat(64),
                    requiredToolRefs: ['memory://read'],
                  },
                ],
                toolRefs: ['memory://read'],
              } as any)
            : null,
      },
      definitions: {
        findTeamDefinitionById: async () => null,
        findPublishedTeamVersionById: async () => null,
      },
      environments: {
        findVersion: async (_owner: unknown, id: string) =>
          id === environmentVersionId
            ? ({
                id,
                status: 'published',
                fingerprint: 'sha256:environment-version',
              } as any)
            : null,
      },
      authoredDefinitions: sources,
      memories: {
        findVersion: async (id: string) =>
          id === memoryVersionId
            ? {
                versionId: id,
                memoryId: 'a7777777-7777-4777-8777-777777777777',
                storeId: 'a8888888-8888-4888-8888-888888888888',
                path: 'principles.md',
                content: 'Prefer pinned evidence.',
                contentSha256: 'b'.repeat(64),
              }
            : null,
      },
    } as any);
    const repository = new PostgresWorkIdentityRepository(pool);
    const identity = new WorkIdentityApi({
      repository,
      definitions: {
        findTeamDefinitionById: async () => null,
        findPublishedTeamVersionById: async () => null,
      },
      definitionResolution: resolver,
      now: () => new Date(at),
    });
    const work = await identity.createWork({
      owner: { tenantId, workspaceId },
      definitionId,
      definitionVersionId,
      title: 'Composition Real PG Work',
      accessContext: access,
    });
    createdWorkIds.push(work.id);

    const admitRoot = vi.fn(async (request: any) => {
      const taskId = randomUUID();
      await pool.query(
        `INSERT INTO tasks
         (id,tenant_id,workspace_id,principal_type,principal_id,
          policy_snapshot_version,root_task_id,depth,status,ingress,
          invokable_kind,invokable_version_id,input_snapshot_ref,input_fingerprint,
          created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$1,0,'active','api',$7,$8,'composition','composition',$9,$9)`,
        [
          taskId,
          tenantId,
          workspaceId,
          access.principalType,
          principalId,
          access.policySnapshotVersion,
          request.invokable.kind,
          request.invokable.versionId,
          at,
        ],
      );
      createdTaskIds.push(taskId);
      return { taskId, reused: false };
    });
    const start = new StartWorkRun({
      identity,
      execution: { admitRoot },
      runtimeCapabilities: {
        supported: new Set(['external_workspace', 'platform_mcp'] as const),
      },
      now: () => new Date(at),
    });

    const started = await start.execute({
      accessContext: access,
      workId: work.id,
      triggerKind: 'manual',
      triggerRef: 'composition-real-pg',
    });
    expect(admitRoot).toHaveBeenCalledWith(
      expect.objectContaining({
        invokable: { kind: 'worker', versionId: agentVersionId },
      }),
    );
    expect(started.workRun.rootTaskId).not.toBeNull();

    const manifest = await repository.getResolvedManifest(started.workRun.id, {
      tenantId,
      workspaceId,
    });
    expect(manifest?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceKind: 'definition',
          resolvedVersionId: definitionVersionId,
        }),
        expect.objectContaining({
          resourceKind: 'worker',
          resolvedVersionId: agentVersionId,
        }),
        expect.objectContaining({
          resourceKind: 'environment',
          resolvedVersionId: environmentVersionId,
        }),
        expect.objectContaining({
          resourceKind: 'memory',
          resolvedVersionId: memoryVersionId,
          resolvedFingerprint: `sha256:${'b'.repeat(64)}`,
        }),
        expect.objectContaining({
          resourceKind: 'skill',
          requestedRef: 'composition-research-skill',
        }),
        expect.objectContaining({
          resourceKind: 'tool',
          requestedRef: 'memory://read',
        }),
        expect.objectContaining({
          resourceKind: 'platform_capability',
          requestedRef: 'platform_mcp',
        }),
      ]),
    );
  });

  it('projects a collaboration WorkRun trace with a senderless system claim wake', async () => {
    const collaborationDefinitionId = randomUUID();
    const collaborationVersionId = randomUUID();
    const rootTaskId = randomUUID();
    const teamRunId = randomUUID();
    const actorId = randomUUID();
    const messageId = randomUUID();
    const repository = new PostgresWorkIdentityRepository(pool);
    const resolved = {
      definitionId: collaborationDefinitionId,
      definitionVersionId: collaborationVersionId,
      kind: 'collaboration' as const,
      name: 'Collaboration projection',
      description: null,
      sourceFingerprint: 'sha256:collaboration-source',
      resolvedFingerprint: 'sha256:collaboration-resolved',
      participants: [],
      environment: null,
      memories: [],
      platformCapabilities: ['collaboration', 'platform_mcp'] as const,
      executionPolicy: {
        invokable: { kind: 'team' as const, versionId: collaborationVersionId },
        requiredRuntimeCapabilities: ['platform_mcp'] as const,
      },
    };
    const identity = new WorkIdentityApi({
      repository,
      definitions: {
        findTeamDefinitionById: async () => null,
        findPublishedTeamVersionById: async () => null,
      },
      definitionResolution: { resolve: async () => resolved },
      now: () => new Date(at),
    });
    const work = await identity.createWork({
      owner: { tenantId, workspaceId },
      definitionId: collaborationDefinitionId,
      definitionVersionId: collaborationVersionId,
      title: 'Collaboration projection',
      accessContext: access,
    });
    createdWorkIds.push(work.id);
    const pending = await identity.startWorkRun({
      owner: { tenantId, workspaceId },
      workId: work.id,
      triggerKind: 'manual',
      triggerRef: `projection-${teamRunId}`,
      accessContext: access,
    });
    await pool.query(
      `INSERT INTO tasks
       (id,tenant_id,workspace_id,principal_type,principal_id,
        policy_snapshot_version,root_task_id,depth,status,ingress,
        invokable_kind,invokable_version_id,input_snapshot_ref,input_fingerprint,
        created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$1,0,'completed','api','team',$7,'projection','projection',$8,$8)`,
      [
        rootTaskId,
        tenantId,
        workspaceId,
        access.principalType,
        principalId,
        access.policySnapshotVersion,
        collaborationVersionId,
        at,
      ],
    );
    createdTaskIds.push(rootTaskId);
    await identity.bindRootTaskCas({
      workRunId: pending.id,
      rootTaskId,
      owner: { tenantId, workspaceId },
      now: at,
    });
    await pool.query(
      `INSERT INTO team_runs
       (id,tenant_id,workspace_id,principal_type,principal_id,root_task_id,root_run_id,
        team_version_id,environment_version_id,status,phase,final_text,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'succeeded','done','done',$10,$10)`,
      [
        teamRunId,
        tenantId,
        workspaceId,
        access.principalType,
        principalId,
        rootTaskId,
        randomUUID(),
        collaborationVersionId,
        environmentVersionId,
        at,
      ],
    );
    await pool.query(
      `INSERT INTO team_member_runs
       (id,team_run_id,name,role,worker_version_id,status,tenant_id,workspace_id,
        principal_type,principal_id,created_at,updated_at)
       VALUES($1,$2,'analyst','member',$3,'idle',$4,$5,$6,$7,$8,$8)`,
      [
        actorId,
        teamRunId,
        agentVersionId,
        tenantId,
        workspaceId,
        access.principalType,
        principalId,
        at,
      ],
    );
    await pool.query(
      `INSERT INTO team_messages
       (id,team_run_id,tenant_id,workspace_id,principal_type,principal_id,sequence,
        sender_member_run_id,recipient_member_run_id,kind,dedup_key,body,status,created_at)
       VALUES($1,$2,$3,$4,$5,$6,1,NULL,$7,'wake','system-claim','claimed_work','queued',$8)`,
      [
        messageId,
        teamRunId,
        tenantId,
        workspaceId,
        access.principalType,
        principalId,
        actorId,
        at,
      ],
    );
    const projection = createProductProjection({
      workIdentity: repository,
      workFacts: new WorkProjectionFactsSource({
        getByRootTask: async ({ tenantId, workspaceId, rootTaskId }) =>
          new PostgresWorkProjectionFactsQuery(pool).getByRootTask(
            { tenantId, workspaceId },
            rootTaskId,
          ),
      }),
      executionFacts: {
        listRunsByRootTask: async () => [
          {
            runId: randomUUID(),
            taskId: rootTaskId,
            rootTaskId,
            status: 'succeeded' as const,
            provider: null,
            model: null,
            resultPresent: true,
            resultText: 'Completed root result.',
            errorCode: null,
            actorId: null,
            workItemId: null,
            startedAt: at,
            endedAt: at,
            createdAt: at,
            updatedAt: at,
          },
        ],
        listRunEvents: async () => [],
      },
    });

    const trace = await projection.getRunTrace({
      tenantId,
      workspaceId,
      workId: work.id,
      workRunId: pending.id,
    });
    if ('error' in trace || trace.work_run === null)
      throw new Error('expected captured collaboration trace');
    expect(trace.messages).toEqual([]);
    expect(trace.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'observed_message',
          message_id: messageId,
          sender_actor_id: null,
        }),
      ]),
    );
  });
});
