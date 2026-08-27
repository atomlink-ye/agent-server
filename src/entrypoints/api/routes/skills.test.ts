import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { SkillCatalogPort } from '../../../application/extensions/skill-catalog.js';
import { SkillListResponseSchema } from '../../../contracts/skills.js';
import type { AppConfig } from '../../../shared/config.js';
import type { ApiEnvironment } from '../http-types.js';
import { createHttpApp } from '../app.js';
import { registerSkillRoutes } from './skills.js';

const config = {
  serviceAccounts: [
    {
      serviceAccountId: 'svc-1',
      token: 'token-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      policyVersion: 'policy-1',
      disabled: false,
    },
  ],
} as unknown as AppConfig;

const headers = { authorization: 'Bearer token-1' };

describe('Skill catalog route', () => {
  it('returns the catalog in the wire-facing snake_case shape', async () => {
    const list = vi.fn().mockResolvedValue([
      {
        ref: 'agent-server/memory-api',
        name: 'agent-server/memory-api',
        digest: 'sha256:example',
        objectPath: '/registry/objects/sha256:example',
        manifestPath: '/registry/refs/agent-server/memory-api.json',
        delivery: 'native_project' as const,
        requiredToolRefs: ['agent-server/memory-read'],
      },
    ]);
    const app = createApp({ list });

    const response = await app.request('/api/v1/skills', { headers });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(SkillListResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toEqual({
      skills: [
        {
          ref: 'agent-server/memory-api',
          name: 'agent-server/memory-api',
          required_tool_refs: ['agent-server/memory-read'],
        },
      ],
    });
    expect(list).toHaveBeenCalledWith();
  });

  it('requires service-account authentication', async () => {
    const app = createApp({ list: vi.fn() });

    const response = await app.request('/api/v1/skills');

    expect(response.status).toBe(401);
  });

  it('is absent when the Product Work surface is not composed', async () => {
    const list = vi.fn().mockResolvedValue([]);
    const notComposedApp = createHttpApp({
      ...baseAppDependencies(),
      config: { ...config, productWorkSurface: 'absent' } as AppConfig,
      resourceModule: {
        installHttp() {},
        installProductWorkHttp(target) {
          registerSkillRoutes(target, {
            config,
            skillCatalog: { list },
          });
        },
        managedAgentDefinitions: {} as never,
      },
    });

    const response = await notComposedApp.request('/api/v1/skills', {
      headers,
    });

    expect(response.status).toBe(404);
    expect(list).not.toHaveBeenCalled();

    const composedApp = createHttpApp({
      ...baseAppDependencies(),
      config: { ...config, productWorkSurface: 'composed' } as AppConfig,
      resourceModule: {
        installHttp() {},
        installProductWorkHttp(target) {
          registerSkillRoutes(target, {
            config,
            skillCatalog: { list },
          });
        },
        managedAgentDefinitions: {} as never,
      },
    });

    const composedResponse = await composedApp.request('/api/v1/skills', {
      headers,
    });

    expect(composedResponse.status).toBe(200);
    expect(list).toHaveBeenCalledOnce();
  });
});

function createApp(skillCatalog: Pick<SkillCatalogPort, 'list'>) {
  const app = new Hono<ApiEnvironment>();
  registerSkillRoutes(app, { config, skillCatalog });
  return app;
}

function baseAppDependencies() {
  return {
    logger: { log: () => undefined },
    readiness: { check: async () => [] } as never,
    runtime: {} as never,
    submitRun: {} as never,
    getRun: {} as never,
    invokeTask: {} as never,
    getTask: {} as never,
    getTaskTree: {} as never,
    teamExecutions: {} as never,
    teamDriver: {} as never,
    teamMessages: {} as never,
    tasks: {} as never,
    sessions: {} as never,
    submitSessionTurn: {} as never,
    events: {} as never,
    cancelTask: {} as never,
    memoryModule: { installHttp() {} },
  };
}
