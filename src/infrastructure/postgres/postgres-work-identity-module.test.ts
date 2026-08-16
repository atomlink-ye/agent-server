import { describe, expect, it, vi } from 'vitest';

import {
  createPostgresWorkIdentityModule,
  PostgresWorkIdentityRepository,
} from './postgres-work-identity-repository.js';
import { WorkWorkspaceScopeUnavailableError } from '../../domain/work/work.js';

describe('Postgres Work identity module', () => {
  it('does not let the raw write repository escape through its query facade', () => {
    const module = createPostgresWorkIdentityModule({
      database: {
        async query<Row>() {
          return { rows: [] as Row[] };
        },
      },
      definitions: {
        findTeamDefinitionById: async () => null,
        findPublishedTeamVersionById: async () => null,
      },
      execution: {
        admitRoot: async () => {
          throw new Error('not called by module construction');
        },
      },
    });

    expect(Object.keys(module.workIdentityQuery).sort()).toEqual([
      'findLatestVisibleWorkRun',
      'findWorkById',
      'findWorkRunById',
    ]);
    expect(module.workIdentityQuery).not.toHaveProperty('createWork');
    expect(module.workIdentityQuery).not.toHaveProperty('bindRootTaskCas');
    expect(module.workIdentityQuery).not.toHaveProperty(
      'appendResolvedManifest',
    );
  });

  it('selects the latest visible WorkRun without using the paginated list', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repository = new PostgresWorkIdentityRepository({ query });

    await repository.findLatestVisibleWorkRun(work().id, {
      tenantId: work().tenantId,
      workspaceId: work().workspaceId,
    });

    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]![0]).toContain(
      'ORDER BY created_at DESC,id DESC LIMIT 1',
    );
    expect(query.mock.calls[0]![0]).toContain(
      '(root_task_id IS NOT NULL OR expires_at > now())',
    );
    expect(query.mock.calls[0]![1]).toEqual([
      work().id,
      work().tenantId,
      work().workspaceId,
    ]);
  });

  it('pins the resolved manifest while the WorkRun is still pending', async () => {
    const entry = {
      slot: 'definition',
      resourceKind: 'definition' as const,
      requestedRef: 'agent:version-1',
      resolvedVersionId: 'version-1',
      resolvedFingerprint: 'sha256:definition',
      resolvedAt: '2026-08-16T00:00:00.000Z',
    };
    const queries: string[] = [];
    const client = {
      release: vi.fn(),
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.startsWith('SELECT id FROM work_runs'))
          return { rows: [{ id: 'run-1' }] };
        if (sql.includes('FROM work_run_resource_manifest')) {
          if (sql.includes('FOR UPDATE')) return { rows: [] };
          return {
            rows: [
              {
                work_run_id: 'run-1',
                tenant_id: 'tenant-1',
                workspace_id: '00000000-0000-4000-8000-000000000102',
                slot: entry.slot,
                resource_kind: entry.resourceKind,
                requested_ref: entry.requestedRef,
                resolved_version_id: entry.resolvedVersionId,
                resolved_fingerprint: entry.resolvedFingerprint,
                resolved_at: entry.resolvedAt,
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };
    const repository = new PostgresWorkIdentityRepository({
      query: client.query,
      connect: async () => client,
    });

    const manifest = await repository.appendResolvedManifest({
      workRunId: 'run-1',
      owner: {
        tenantId: 'tenant-1',
        workspaceId: '00000000-0000-4000-8000-000000000102',
      },
      entries: [entry],
    });

    expect(manifest.entries).toEqual([entry]);
    expect(queries.some((sql) => sql.includes('root_task_id') && sql.includes('FOR UPDATE'))).toBe(false);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it.each([
    [{ code: '22P02' }],
    [{ code: '23503', constraint: 'works_workspace_id_tenant_id_fkey' }],
  ])('maps workspace scope persistence failures safely: %j', async (error) => {
    const repository = new PostgresWorkIdentityRepository({
      query: vi.fn().mockRejectedValue(error),
    });

    await expect(repository.createWork(work())).rejects.toBeInstanceOf(
      WorkWorkspaceScopeUnavailableError,
    );
  });

  it('preserves unrelated work persistence failures', async () => {
    const error = new Error('database unavailable');
    const repository = new PostgresWorkIdentityRepository({
      query: vi.fn().mockRejectedValue(error),
    });

    await expect(repository.createWork(work())).rejects.toBe(error);
  });

  it('preserves unrelated foreign-key failures', async () => {
    const error = {
      code: '23503',
      constraint: 'works_definition_id_fkey',
    };
    const repository = new PostgresWorkIdentityRepository({
      query: vi.fn().mockRejectedValue(error),
    });

    await expect(repository.createWork(work())).rejects.toBe(error);
  });
});

function work() {
  return {
    id: '00000000-0000-4000-8000-000000000101',
    tenantId: 'tenant-1',
    workspaceId: '00000000-0000-4000-8000-000000000102',
    definitionId: '00000000-0000-4000-8000-000000000103',
    currentDefinitionVersionId: '00000000-0000-4000-8000-000000000104',
    title: 'Work',
    origin: 'created' as const,
    archivedAt: null,
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:00.000Z',
  };
}
