import { PGlite } from '@electric-sql/pglite';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ListAgentHomeEntries,
  WriteAgentHomeEntry,
} from '../../src/application/agents/agent-home.js';
import { SeedCoworkerIdentityFiles } from '../../src/application/agents/seed-coworker-identity-files.js';
import { EnsureCoworkerConversation } from '../../src/application/chat/ensure-coworker-conversation.js';
import { CreateCoworkerResponseSchema } from '../../src/contracts/agents.js';
import { HttpError } from '../../src/contracts/http.js';
import { registerCoworkerAuthoringRoute } from '../../src/entrypoints/api/routes/coworker-authoring.js';
import { PostgresAgentHomeDefinitionSource } from '../../src/infrastructure/postgres/postgres-agent-home-definition-source.js';
import { PostgresAgentHomeRepository } from '../../src/infrastructure/postgres/postgres-agent-home-repository.js';
import { PostgresAgentRegistry } from '../../src/infrastructure/postgres/postgres-agent-registry.js';
import { PostgresConversationRepository } from '../../src/infrastructure/postgres/postgres-conversation-repository.js';
import { PostgresConversationWorkEntitlementRepository } from '../../src/infrastructure/postgres/postgres-conversation-work-entitlement-repository.js';
import { applyDurableKernelMigrations } from '../../src/infrastructure/postgres/postgres.js';
import type { ApiEnvironment } from '../../src/entrypoints/api/http-types.js';
import type { AppConfig } from '../../src/shared/config.js';

const token = 'coworker-identity-files-token';
const tenantId = 'tenant_coworker_identity';
const workspaceId = 'b1000000-0000-4000-8000-000000000301';
const serviceAccountId = 'svc_coworker_identity';
const now = '2026-09-08T09:00:00.000Z';

const draft = {
  name: 'Maya',
  role: 'Research Analyst',
  summary: 'Researches markets and writes concise briefs.',
  instructions: 'Lead with the number. Never pad a brief.',
};

let database: PGlite | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

describe('a hired Coworker owns the files that say who it is', () => {
  it('seeds them from the hire form into the area its own workspace tools read', async () => {
    const app = await workspace();
    const created = await hire(app);

    const entries = await agentWorkspaceEntries(created.agent_id);

    expect(entries.map((entry) => entry.path)).toEqual([
      'IDENTITY.md',
      'SOUL.md',
    ]);
    const identity = entries.find((entry) => entry.path === 'IDENTITY.md');
    expect(identity?.content).toContain('# Maya');
    expect(identity?.content).toContain('**Role:** Research Analyst');
    expect(identity?.content).toContain(
      '**Bio:** Researches markets and writes concise briefs.',
    );
    const soul = entries.find((entry) => entry.path === 'SOUL.md');
    expect(soul?.content).toContain('Lead with the number. Never pad a brief.');
  });

  it('writes nothing a person did not type: no working style, no SOUL.md', async () => {
    const app = await workspace();
    const created = await hire(app, {
      name: 'Rune',
      role: 'Support Lead',
      summary: 'Answers customer escalations.',
    });

    const entries = await agentWorkspaceEntries(created.agent_id);

    expect(entries.map((entry) => entry.path)).toEqual(['IDENTITY.md']);
  });

  it('lets the Coworker rewrite its own identity through the same rows', async () => {
    const app = await workspace();
    const created = await hire(app);

    // Exactly what the `workspace_write` MCP tool does on the Agent's behalf.
    await new WriteAgentHomeEntry(
      new PostgresAgentHomeRepository(database!),
    ).execute({
      accessContext: {
        tenantId,
        workspaceId,
        principalType: 'service_account',
        principalId: serviceAccountId,
      },
      agentDefinitionId: created.agent_id,
      namespace: 'agent-shared',
      scopeParams: { workspaceId },
      path: 'IDENTITY.md',
      content: '# Maya\n\n**Role:** Research Analyst, now also on pricing.',
    });

    const entries = await agentWorkspaceEntries(created.agent_id);
    const identity = entries.find((entry) => entry.path === 'IDENTITY.md');

    expect(identity?.content).toContain('now also on pricing');
    expect(identity?.content).not.toContain('**Bio:**');
  });

  it('keeps one Coworker out of another Coworker workspace', async () => {
    const app = await workspace();
    const maya = await hire(app);
    const rune = await hire(app, {
      name: 'Rune',
      role: 'Support Lead',
      summary: 'Answers customer escalations.',
    });

    const mayaFiles = await agentWorkspaceEntries(maya.agent_id);
    const runeFiles = await agentWorkspaceEntries(rune.agent_id);

    expect(mayaFiles.find((e) => e.path === 'IDENTITY.md')?.content).toContain(
      '# Maya',
    );
    expect(runeFiles.find((e) => e.path === 'IDENTITY.md')?.content).toContain(
      '# Rune',
    );
    expect(runeFiles.map((e) => e.path)).toEqual(['IDENTITY.md']);
  });
});

/** Read back exactly the way the Chat brain projects an Agent's own files. */
async function agentWorkspaceEntries(
  agentDefinitionId: string,
): Promise<readonly { path: string; content: string }[]> {
  const entries = await new ListAgentHomeEntries(
    new PostgresAgentHomeRepository(database!),
    new PostgresAgentHomeDefinitionSource(database!),
  ).execute({
    accessContext: {
      tenantId,
      workspaceId,
      principalType: 'user',
      principalId: 'person-a',
    },
    agentDefinitionId,
    namespace: 'agent-shared',
    scopeParams: { workspaceId },
  });
  return (entries ?? []).map(({ path, content }) => ({ path, content }));
}

async function hire(
  app: Hono<ApiEnvironment>,
  body: Record<string, unknown> = draft,
): Promise<{ agent_id: string; conversation_id: string }> {
  const response = await app.request('/api/v1/coworkers', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `coworker-identity-${String(body.name)}`,
      'x-agent-server-user-id': 'person-a',
    },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(201);
  return CreateCoworkerResponseSchema.parse(await response.json());
}

async function workspace(): Promise<Hono<ApiEnvironment>> {
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
      'Coworker Identity Workspace',
      now,
    ],
  );

  const agentRegistry = new PostgresAgentRegistry(database);
  const app = new Hono<ApiEnvironment>();
  app.onError((error, context) => {
    if (error instanceof HttpError)
      return context.json(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    throw error;
  });
  registerCoworkerAuthoringRoute(app, {
    config: config(),
    agentRegistry,
    coworkerProvisioning: new EnsureCoworkerConversation(
      new PostgresConversationRepository(database),
      new PostgresConversationWorkEntitlementRepository(database),
    ),
    identityFiles: new SeedCoworkerIdentityFiles(
      new WriteAgentHomeEntry(new PostgresAgentHomeRepository(database)),
    ),
  });
  return app;
}

function config(): AppConfig {
  return {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 3000,
    logLevel: 'error',
    serviceName: 'coworker-identity-test',
    directChatPlane: 'execution_runtime',
    productWorkSurface: 'composed',
    runtimeAdapter: 'none',
    teamCompletionApprovalRequired: false,
    skillRegistryRoot: '.local/skill-registry',
    chat: { activationBurstDebounceMs: 0 },
    runtimeMcp: {
      listenHost: '127.0.0.1',
      advertisedHost: '127.0.0.1',
      port: 0,
    },
    paseo: {
      wsUrl: 'ws://127.0.0.1:6767/ws',
      provider: 'codex',
      agentCwd: '.local/agent-workspace',
      workspaceTitle: 'Agent Server Test',
      connectTimeoutMs: 10_000,
      connectTimeoutSource: 'default',
      executionTimeoutMs: 150_000,
      executionTimeoutSource: 'default',
      sessionRpcTimeoutMs: 60_000,
      sessionRpcTimeoutSource: 'default',
    },
    serviceAccounts: [
      {
        serviceAccountId,
        token,
        tenantId,
        workspaceId,
        policyVersion: 'policy-1',
        disabled: false,
      },
    ],
  } as unknown as AppConfig;
}
