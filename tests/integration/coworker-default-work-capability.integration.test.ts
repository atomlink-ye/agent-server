import { PGlite } from '@electric-sql/pglite';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';

import { createResourceModule } from '../../src/composition/create-resource-capabilities.js';
import { CreateCoworkerResponseSchema } from '../../src/contracts/agents.js';
import { HttpError } from '../../src/contracts/http.js';
import { PostgresWorkspaceMembershipRepository } from '../../src/infrastructure/postgres/postgres-workspace-membership-repository.js';
import { applyDurableKernelMigrations } from '../../src/infrastructure/postgres/postgres.js';
import type { ApiEnvironment } from '../../src/entrypoints/api/http-types.js';
import type { AppConfig } from '../../src/shared/config.js';

const token = 'coworker-default-capability-token';
const tenantId = 'tenant_coworker_capability';
const workspaceId = 'b1000000-0000-4000-8000-000000000401';
const serviceAccountId = 'svc_coworker_capability';
const now = '2026-09-07T12:00:00.000Z';

const draft = {
  name: 'Iris',
  role: 'Release Analyst',
  summary: 'Tracks release risks and keeps a running log.',
};

let database: PGlite | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

describe('a Coworker hired by a person', () => {
  it('starts with an empty Work catalog so Work is selected explicitly', async () => {
    const { app, resources } = await workspace();

    const created = CreateCoworkerResponseSchema.parse(
      await (
        await app.request('/api/v1/coworkers', {
          method: 'POST',
          headers: headers('person-a'),
          body: JSON.stringify(draft),
        })
      ).json(),
    );

    // Hiring a Coworker no longer manufactures an Agent-persona Definition.
    // Work is selected explicitly from the shared Definition catalog.
    const bindings = await resources.workDefinitionSources
      .listAgentWorkBindings!({
      tenantId,
      workspaceId,
      principalType: 'service_account',
      principalId: serviceAccountId,
      agentDefinitionId: created.agent_id,
    });
    expect(bindings).toEqual([]);
  });

  it('leaves no binding behind where the Product Work surface is absent', async () => {
    const { app, resources } = await workspace({ productWork: 'absent' });

    const created = CreateCoworkerResponseSchema.parse(
      await (
        await app.request('/api/v1/coworkers', {
          method: 'POST',
          headers: headers('person-b'),
          body: JSON.stringify(draft),
        })
      ).json(),
    );

    // The Coworker is still hired. It simply has no Work here, and says so
    // rather than offering a Capability this deployment cannot execute.
    expect(created.agent_id).toEqual(expect.any(String));
    const bindings = await resources.workDefinitionSources
      .listAgentWorkBindings!({
      tenantId,
      workspaceId,
      principalType: 'service_account',
      principalId: serviceAccountId,
      agentDefinitionId: created.agent_id,
    });
    expect(bindings).toEqual([]);
  });
});

async function workspace(
  options: { readonly productWork?: 'composed' | 'absent' } = {},
): Promise<{
  readonly app: Hono<ApiEnvironment>;
  readonly resources: Awaited<ReturnType<typeof createResourceModule>>;
}> {
  database = new PGlite();
  await applyDurableKernelMigrations(database);
  await database.query(
    `INSERT INTO workspaces
       (id,tenant_id,principal_type,principal_id,name,created_at,updated_at)
     VALUES($1,$2,'service_account',$3,$4,$5,$5)`,
    [
      workspaceId,
      tenantId,
      serviceAccountId,
      'Coworker Capability Workspace',
      now,
    ],
  );

  const appConfig = config(options.productWork ?? 'composed');
  const resources = await createResourceModule({
    database,
    config: appConfig,
  });

  const app = new Hono<ApiEnvironment>();
  app.onError((error, context) => {
    if (error instanceof HttpError)
      return context.json(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    throw error;
  });
  resources.installHttp(app, appConfig, {
    workspaceMembers: new PostgresWorkspaceMembershipRepository(database),
  });
  if (appConfig.productWorkSurface === 'composed')
    resources.installProductWorkHttp(app, appConfig);
  return { app, resources };
}

function headers(userId: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'idempotency-key': `coworker-capability-${userId}`,
    'x-agent-server-user-id': userId,
  };
}

function accessContext() {
  return {
    tenantId,
    workspaceId,
    principalType: 'service_account' as const,
    principalId: serviceAccountId,
    policySnapshotVersion: 'policy-coworker-capability',
  };
}

function config(productWorkSurface: 'composed' | 'absent'): AppConfig {
  return {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 3000,
    logLevel: 'error',
    serviceName: 'coworker-capability-test',
    directChatPlane: 'execution_runtime',
    productWorkSurface,
    teamCompletionApprovalRequired: false,
    skillRegistryRoot: '.local/coworker-capability-test',
    chat: { activationBurstDebounceMs: 2_000 },
    serviceAccounts: [
      {
        serviceAccountId,
        token,
        tenantId,
        workspaceId,
        policyVersion: 'policy-coworker-capability',
        disabled: false,
      },
    ],
    paseo: {
      wsUrl: 'ws://127.0.0.1:6767/ws',
      agentCwd: '.local/coworker-capability-test',
      provider: 'opencode',
      workspaceTitle: 'Coworker Capability Test',
      connectTimeoutMs: 1000,
      connectTimeoutSource: 'default',
      executionTimeoutMs: 1000,
      executionTimeoutSource: 'default',
      sessionRpcTimeoutMs: 2000,
      sessionRpcTimeoutSource: 'default',
    },
  } as AppConfig;
}
