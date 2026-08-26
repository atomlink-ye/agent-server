import { PGlite } from '@electric-sql/pglite';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';

import { EnsureCoworkerConversation } from '../../src/application/chat/ensure-coworker-conversation.js';
import {
  AgentCoworkerListResponseSchema,
  ImportAgentResponseSchema,
} from '../../src/contracts/agents.js';
import { registerAgentRoutes } from '../../src/entrypoints/api/routes/agents.js';
import { PostgresAgentRegistry } from '../../src/infrastructure/postgres/postgres-agent-registry.js';
import { PostgresConversationRepository } from '../../src/infrastructure/postgres/postgres-conversation-repository.js';
import { PostgresConversationWorkEntitlementRepository } from '../../src/infrastructure/postgres/postgres-conversation-work-entitlement-repository.js';
import { applyDurableKernelMigrations } from '../../src/infrastructure/postgres/postgres.js';
import type { ApiEnvironment } from '../../src/entrypoints/api/http-types.js';
import type { AppConfig } from '../../src/shared/config.js';

const token = 'coworker-api-token';
const tenantId = 'tenant_coworker_api';
const workspaceId = '91000000-0000-4000-8000-000000000101';
const principalId = 'svc_coworker_api';
let database: PGlite | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

describe('Coworker Agent API lifecycle', () => {
  it('lists only published Coworkers and makes publish provisioning replay-safe', async () => {
    database = new PGlite();
    await applyDurableKernelMigrations(database);
    const now = '2026-08-22T10:00:00.000Z';
    await database.query(
      `INSERT INTO workspaces
         (id,tenant_id,principal_type,principal_id,name,created_at,updated_at)
       VALUES($1,$2,'service_account',$3,$4,$5,$5)`,
      [workspaceId, tenantId, principalId, 'Coworker API Workspace', now],
    );

    const registry = new PostgresAgentRegistry(database);
    const conversations = new PostgresConversationRepository(database);
    const workEntitlements = new PostgresConversationWorkEntitlementRepository(
      database,
    );
    const app = new Hono<ApiEnvironment>();
    registerAgentRoutes(app, {
      config: config(),
      agentRegistry: registry,
      coworkerProvisioning: new EnsureCoworkerConversation(
        conversations,
        workEntitlements,
      ),
    });

    const imported = await app.request('/api/v1/agents:import', {
      method: 'POST',
      headers: authHeaders('coworker-api-import'),
      body: JSON.stringify({ source: source() }),
    });
    expect(imported.status).toBe(201);
    const importedBody = ImportAgentResponseSchema.parse(await imported.json());

    const beforePublish = await app.request('/api/v1/agents', {
      headers: authHeaders(),
    });
    expect(beforePublish.status).toBe(200);
    expect(
      AgentCoworkerListResponseSchema.parse(await beforePublish.json()).items,
    ).toEqual([]);

    const publishPath = `/api/v1/agent-versions/${importedBody.version.id}:publish`;
    const firstPublish = await app.request(publishPath, {
      method: 'POST',
      headers: authHeaders('coworker-api-publish'),
      body: '{}',
    });
    expect(firstPublish.status).toBe(200);

    const roster = AgentCoworkerListResponseSchema.parse(
      await (
        await app.request('/api/v1/agents?limit=20', { headers: authHeaders() })
      ).json(),
    );
    expect(roster.items).toEqual([
      expect.objectContaining({
        id: importedBody.agent.id,
        display_name: importedBody.agent.display_name,
        active_agent_version_id: importedBody.version.id,
        runtime_status: 'available',
      }),
    ]);

    const firstCounts = await counts(importedBody.agent.id);
    expect(firstCounts).toEqual({ conversations: 1, entitlements: 1 });

    const replay = await app.request(publishPath, {
      method: 'POST',
      headers: authHeaders('coworker-api-publish'),
      body: '{}',
    });
    expect(replay.status).toBe(200);
    expect(await counts(importedBody.agent.id)).toEqual(firstCounts);
  });
});

async function counts(agentDefinitionId: string): Promise<{
  conversations: number;
  entitlements: number;
}> {
  const pairKey = `direct:${tenantId}:${principalId}:${agentDefinitionId}`;
  const conversationRows = await database!.query<{ id: string }>(
    `SELECT id FROM conversations WHERE tenant_id=$1 AND direct_pair_key=$2`,
    [tenantId, pairKey],
  );
  const conversationId = conversationRows.rows[0]?.id;
  const entitlementRows = conversationId
    ? await database!.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
           FROM conversation_work_entitlements
          WHERE tenant_id=$1 AND conversation_id=$2`,
        [tenantId, conversationId],
      )
    : { rows: [{ count: 0 }] };
  return {
    conversations: conversationRows.rows.length,
    entitlements: entitlementRows.rows[0]?.count ?? 0,
  };
}

function authHeaders(idempotencyKey?: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
  };
}

function config(): AppConfig {
  return {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 3000,
    logLevel: 'error',
    serviceName: 'coworker-api-test',
    directChatPlane: 'execution_runtime',
    productWorkPlane: 'execution_runtime',
    productWorkAvailability: { surface: 'composed', execution: 'runtime' },
    teamCompletionApprovalRequired: false,
    skillRegistryRoot: '/tmp/coworker-api-test',
    serviceAccounts: [
      {
        serviceAccountId: principalId,
        token,
        tenantId,
        workspaceId,
        policyVersion: 'policy-coworker-api',
        disabled: false,
      },
    ],
    paseo: {
      wsUrl: 'ws://127.0.0.1:6767/ws',
      agentCwd: '/tmp/coworker-api-test',
      provider: 'opencode',
      workspaceTitle: 'Coworker API Test',
      connectTimeoutMs: 1000,
      connectTimeoutSource: 'default',
      executionTimeoutMs: 1000,
      executionTimeoutSource: 'default',
      sessionRpcTimeoutMs: 2000,
      sessionRpcTimeoutSource: 'default',
    },
  } as AppConfig;
}

function source(): string {
  return `apiVersion: agent-server/v1alpha1
kind: ManagedAgent
metadata:
  name: API Coworker
spec:
  description: Product-facing coworker
  instructions: Discuss naturally and start formal Work when durable execution is needed.
  runtime:
    provider: paseo
    modelPolicyRef: free-only
    mode: isolated
  tools: []
  skills: []
  input:
    schema:
      type: object
      additionalProperties: false
      properties: {}
    prompt: hello
  session:
    invocation: fresh_per_invocation
    followUps: queued
    binding: reusable
  memory:
    policy: workspace_snapshot
    proposalLimit: 1
  permissions:
    network: none
    filesystem: none
  completion:
    type: executable
    command: done
`;
}
