import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { HttpError } from '../../../contracts/http.js';
import { WorkWorkspaceScopeUnavailableError } from '../../../domain/work/work.js';
import type { WorkIdentityApi } from '../../../application/work/work-identity-api.js';
import {
  UpdateWorkDefinitionVersionResponseSchema,
  WorkDefinitionResponseSchema,
  WorkListResponseSchema,
} from '../../../contracts/product-work-commands.js';
import type { AppConfig } from '../../../shared/config.js';
import type { ApiEnvironment } from '../../../platform/http-types.js';
import {
  registerProductWorkCommandRoutes,
  type ProductWorkCommandDependencies,
} from './product-work-commands.js';

const config = {
  serviceAccounts: [
    {
      serviceAccountId: 'svc-1',
      token: 'token-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace_main',
      policyVersion: 'policy-1',
      disabled: false,
    },
  ],
} as unknown as AppConfig;

describe('product Work command route', () => {
  it('returns list product state and only the minimum latest run summary', async () => {
    const app = createApp(vi.fn(), {
      listWorks: vi.fn().mockResolvedValue({ items: [work], nextCursor: null }),
      workListProjection: vi.fn().mockResolvedValue({
        ...workResponse,
        product_state: 'complete',
        latest_run_summary: {
          id: runId,
          updated_at: timestamp,
          result_summary: 'Done',
          result_capture_status: 'present',
        },
      }),
    });

    const response = await app.request('/api/v1/works', { headers });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(WorkListResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toEqual({
      works: [
        {
          ...workResponse,
          product_state: 'complete',
          latest_run_summary: {
            id: runId,
            updated_at: timestamp,
            result_summary: 'Done',
            result_capture_status: 'present',
          },
        },
      ],
      next_cursor: null,
    });

    const mutated = structuredClone(body) as {
      works: { product_state?: string }[];
    };
    delete mutated.works[0]!.product_state;
    expect(WorkListResponseSchema.safeParse(mutated).success).toBe(false);
  });

  it('routes updated_desc through the dedicated Product ordering seam', async () => {
    const compatibilityList = vi.fn();
    const latestList = vi
      .fn()
      .mockResolvedValue({ items: [work], nextCursor: 'next-page' });
    const app = createApp(vi.fn(), {
      listWorks: compatibilityList,
      productLists: {
        listWorksLatestFirst: latestList,
        listWorkRunsLatestFirst: vi.fn(),
      },
      workListProjection: vi.fn().mockResolvedValue({
        ...workResponse,
        product_state: 'complete',
        latest_run_summary: null,
      }),
    });

    const response = await app.request(
      '/api/v1/works?limit=1&order=updated_desc',
      { headers },
    );
    expect(response.status).toBe(200);
    expect(compatibilityList).not.toHaveBeenCalled();
    expect(latestList).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', workspaceId: 'workspace_main' },
      { limit: 1, cursor: null },
    );
    expect(await response.json()).toMatchObject({ next_cursor: 'next-page' });
  });

  it('returns the owner-scoped current definition and version wrapper', async () => {
    const app = createApp(vi.fn(), {
      getWorkDefinition: vi.fn().mockResolvedValue(definitionBinding),
    });

    const response = await app.request(`/api/v1/works/${work.id}/definition`, {
      headers,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(WorkDefinitionResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({
      definition: { id: definitionId, name: 'Team' },
      version: {
        id: definitionVersionId,
        definition_id: definitionId,
        status: 'published',
      },
    });

    const mutated = structuredClone(body) as { version: { spec?: unknown } };
    delete mutated.version.spec;
    expect(WorkDefinitionResponseSchema.safeParse(mutated).success).toBe(false);
  });

  it('pins a same-lineage immutable DefinitionVersion on the Work', async () => {
    const nextVersionId = '00000000-0000-4000-8000-000000000306';
    const updateCurrentDefinitionVersion = vi.fn().mockResolvedValue({
      ...work,
      currentDefinitionVersionId: nextVersionId,
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    const app = createApp(vi.fn(), { updateCurrentDefinitionVersion });

    const response = await app.request(
      `/api/v1/works/${work.id}/definition-version`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ definition_version_id: nextVersionId }),
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(
      UpdateWorkDefinitionVersionResponseSchema.safeParse(body).success,
    ).toBe(true);
    expect(body.work.definition_version_id).toBe(nextVersionId);
    expect(updateCurrentDefinitionVersion).toHaveBeenCalledWith({
      owner: { tenantId: 'tenant-1', workspaceId: 'workspace_main' },
      accessContext: expect.objectContaining({
        tenantId: 'tenant-1',
        workspaceId: 'workspace_main',
      }),
      workId: work.id,
      definitionVersionId: nextVersionId,
    });
  });

  it('maps an unavailable authenticated workspace scope to an informative conflict', async () => {
    const createWork = vi
      .fn()
      .mockRejectedValue(
        new WorkWorkspaceScopeUnavailableError(),
      ) as unknown as WorkIdentityApi['createWork'];
    const app = createApp(createWork);
    const response = await app.request('/api/v1/works', {
      method: 'POST',
      headers,
      body: JSON.stringify(validRequest()),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: 'workspace_scope_unavailable',
        message: 'The authenticated workspace scope is not provisioned.',
      },
    });
  });

  it('preserves unrelated persistence failures as internal errors', async () => {
    const createWork = vi
      .fn()
      .mockRejectedValue(
        new Error('db unavailable'),
      ) as unknown as WorkIdentityApi['createWork'];
    const app = createApp(createWork);
    const response = await app.request('/api/v1/works', {
      method: 'POST',
      headers,
      body: JSON.stringify(validRequest()),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        code: 'internal_error',
        message: 'The request could not be completed.',
      },
    });
  });
});

function createApp(
  createWork: ProductWorkCommandDependencies['workIdentity']['createWork'],
  overrides: Partial<{
    listWorks: ProductWorkCommandDependencies['workIdentity']['listWorks'];
    getWorkDefinition: ProductWorkCommandDependencies['workIdentity']['getWorkDefinition'];
    updateCurrentDefinitionVersion: ProductWorkCommandDependencies['workIdentity']['updateCurrentDefinitionVersion'];
    workListProjection: ProductWorkCommandDependencies['workListProjection'];
    productLists: NonNullable<ProductWorkCommandDependencies['productLists']>;
  }> = {},
) {
  const app = new Hono<ApiEnvironment>();
  registerProductWorkCommandRoutes(app, {
    config,
    workIdentity: {
      createWork,
      listWorks: overrides.listWorks ?? vi.fn(),
      listWorkRuns: vi.fn(),
      getWorkDefinition: overrides.getWorkDefinition ?? vi.fn(),
      updateCurrentDefinitionVersion:
        overrides.updateCurrentDefinitionVersion ?? vi.fn(),
      getWorkRun: vi.fn(),
    },
    ...(overrides.productLists ? { productLists: overrides.productLists } : {}),
    startWorkRun: { execute: vi.fn() },
    workListProjection: overrides.workListProjection ?? vi.fn(),
  });
  app.onError((error, context) => {
    if (error instanceof HttpError)
      return context.json(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    return context.json(
      {
        error: {
          code: 'internal_error',
          message: 'The request could not be completed.',
        },
      },
      500,
    );
  });
  return app;
}

function validRequest() {
  return {
    definition_id: '00000000-0000-4000-8000-000000000301',
    definition_version_id: '00000000-0000-4000-8000-000000000302',
    title: 'Work',
  };
}

const headers = {
  authorization: 'Bearer token-1',
  'content-type': 'application/json',
};

const timestamp = '2026-01-01T00:00:00.000Z';
const definitionId = '00000000-0000-4000-8000-000000000301';
const definitionVersionId = '00000000-0000-4000-8000-000000000302';
const runId = '00000000-0000-4000-8000-000000000303';
const work = {
  id: '00000000-0000-4000-8000-000000000304',
  tenantId: 'tenant-1',
  workspaceId: '00000000-0000-4000-8000-000000000305',
  definitionId,
  currentDefinitionVersionId: definitionVersionId,
  title: 'Work',
  origin: 'created' as const,
  archivedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const workResponse = {
  id: work.id,
  tenant_id: work.tenantId,
  workspace_id: work.workspaceId,
  definition_id: definitionId,
  definition_version_id: definitionVersionId,
  title: work.title,
  origin: work.origin,
  archived_at: null,
  created_at: timestamp,
  updated_at: timestamp,
};
const definitionBinding = {
  definition: {
    id: definitionId,
    tenantId: 'tenant-1',
    workspaceId: work.workspaceId,
    principalType: 'service_account' as const,
    principalId: 'svc-1',
    name: 'Team',
    description: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  version: {
    id: definitionVersionId,
    definitionId,
    tenantId: 'tenant-1',
    workspaceId: work.workspaceId,
    principalType: 'service_account' as const,
    principalId: 'svc-1',
    status: 'published' as const,
    name: 'Team v1',
    description: null,
    spec: {
      lead: { name: 'Lead', agentVersionId: runId },
      roster: [{ name: 'Member', agentVersionId: work.id }],
      environmentVersionId: work.workspaceId,
    },
    environmentVersionId: work.workspaceId,
    createdAt: timestamp,
    updatedAt: timestamp,
    publishedAt: timestamp,
  },
};
