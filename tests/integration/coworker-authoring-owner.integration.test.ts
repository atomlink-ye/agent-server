import { PGlite } from '@electric-sql/pglite';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';

import { EnsureCoworkerConversation } from '../../src/application/chat/ensure-coworker-conversation.js';
import {
  AgentCoworkerListResponseSchema,
  CreateCoworkerResponseSchema,
} from '../../src/contracts/agents.js';
import { HttpError } from '../../src/contracts/http.js';
import { registerAgentRoutes } from '../../src/entrypoints/api/routes/agents.js';
import { registerConversationRoutes } from '../../src/entrypoints/api/routes/conversations.js';
import { registerCoworkerAuthoringRoute } from '../../src/entrypoints/api/routes/coworker-authoring.js';
import { PostgresAgentRegistry } from '../../src/infrastructure/postgres/postgres-agent-registry.js';
import { PostgresChatDispatchRepository } from '../../src/infrastructure/postgres/postgres-chat-dispatch-repository.js';
import { PostgresConversationRepository } from '../../src/infrastructure/postgres/postgres-conversation-repository.js';
import { PostgresConversationWorkEntitlementRepository } from '../../src/infrastructure/postgres/postgres-conversation-work-entitlement-repository.js';
import { PostgresWorkspaceMembershipRepository } from '../../src/infrastructure/postgres/postgres-workspace-membership-repository.js';
import { applyDurableKernelMigrations } from '../../src/infrastructure/postgres/postgres.js';
import type { ApiEnvironment } from '../../src/entrypoints/api/http-types.js';
import type { AppConfig } from '../../src/shared/config.js';

const token = 'coworker-authoring-owner-token';
const tenantId = 'tenant_coworker_owner';
const workspaceId = 'b1000000-0000-4000-8000-000000000101';
const serviceAccountId = 'svc_coworker_owner';
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

describe('hiring a Coworker from the browser', () => {
  it('gives the first Conversation to the person who hired them, and the Coworker to the tenant', async () => {
    const app = await workspace();

    const created = CreateCoworkerResponseSchema.parse(
      await (
        await app.request('/api/v1/coworkers', {
          method: 'POST',
          headers: headers('person-a'),
          body: JSON.stringify(draft),
        })
      ).json(),
    );

    // 1. The landing page the browser is sent to is readable by its creator.
    //    This is the whole point: a 404 here is the demo's first step failing.
    const landing = await app.request(
      `/api/v1/conversations/${created.conversation_id}`,
      { headers: headers('person-a') },
    );
    expect(landing.status).toBe(200);

    // 2. The Conversation is theirs in the data, not merely readable by luck.
    const members = await database!.query<{
      member_principal_type: string;
      member_id: string;
    }>(
      `SELECT member_principal_type,member_id FROM conversation_members
        WHERE conversation_id=$1 AND member_type='principal'`,
      [created.conversation_id],
    );
    expect(members.rows).toEqual([
      { member_principal_type: 'user', member_id: 'person-a' },
    ]);

    // 3. It shows up in their own Conversation list -- the sidebar that read
    //    "Conversations 0" while the service account owned everything.
    expect(await listConversationIds(app, 'person-a')).toEqual([
      created.conversation_id,
    ]);

    // 4. Work context follows the human, so the Coworker can still call Work
    //    in the Conversation it was hired into.
    const entitlement = await new PostgresConversationWorkEntitlementRepository(
      database!,
    ).resolveForChatTurn({
      tenantId,
      conversationId: created.conversation_id,
      agentDefinitionId: created.agent_id,
    });
    expect(entitlement).toMatchObject({
      principalType: 'user',
      principalId: 'person-a',
      workspaceId,
    });

    // 5. The Coworker itself is the tenant's, not person-a's: a second person
    //    finds Iris on the roster.
    const roster = AgentCoworkerListResponseSchema.parse(
      await (
        await app.request('/api/v1/agents?limit=20', {
          headers: headers('person-b'),
        })
      ).json(),
    );
    expect(roster.items.map((item) => item.id)).toEqual([created.agent_id]);
    expect(roster.items[0]).toMatchObject({ display_name: draft.name });

    // 6. But the hiring Conversation is not. Person B sees an empty list and
    //    is refused the Conversation even knowing its id.
    expect(await listConversationIds(app, 'person-b')).toEqual([]);
    const reached = await app.request(
      `/api/v1/conversations/${created.conversation_id}`,
      { headers: headers('person-b') },
    );
    expect(reached.status).toBe(404);
  });

  it('still attributes the Conversation to the service account when no human is behind the request', async () => {
    const app = await workspace();

    const created = CreateCoworkerResponseSchema.parse(
      await (
        await app.request('/api/v1/coworkers', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            'idempotency-key': 'coworker-owner-service-account',
          },
          body: JSON.stringify(draft),
        })
      ).json(),
    );

    const conversations = await database!.query<{ direct_pair_key: string }>(
      `SELECT direct_pair_key FROM conversations WHERE id=$1`,
      [created.conversation_id],
    );
    expect(conversations.rows[0]?.direct_pair_key).toBe(
      `direct:${tenantId}:${serviceAccountId}:${created.agent_id}`,
    );
  });
});

async function workspace(): Promise<Hono<ApiEnvironment>> {
  database = new PGlite();
  await applyDurableKernelMigrations(database);
  await database.query(
    `INSERT INTO workspaces
       (id,tenant_id,principal_type,principal_id,name,created_at,updated_at)
     VALUES($1,$2,'service_account',$3,$4,$5,$5)`,
    [workspaceId, tenantId, serviceAccountId, 'Coworker Owner Workspace', now],
  );

  const agentRegistry = new PostgresAgentRegistry(database);
  const conversations = new PostgresConversationRepository(database);
  const workEntitlements = new PostgresConversationWorkEntitlementRepository(
    database,
  );
  const workspaceMembers = new PostgresWorkspaceMembershipRepository(database);
  const coworkerProvisioning = new EnsureCoworkerConversation(
    conversations,
    workEntitlements,
  );

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
    coworkerProvisioning,
    workspaceMembers,
  });
  registerAgentRoutes(app, {
    config: config(),
    agentRegistry,
    coworkerProvisioning,
  });
  registerConversationRoutes(app, {
    config: config(),
    conversations,
    dispatches: new PostgresChatDispatchRepository(database),
    managedAgentDefinitions: agentRegistry,
    workEntitlements,
    workspaceMembers,
  });
  return app;
}

async function listConversationIds(
  app: Hono<ApiEnvironment>,
  userId: string,
): Promise<readonly string[]> {
  const response = await app.request('/api/v1/conversations', {
    headers: headers(userId),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    conversations: readonly { conversation_id: string }[];
  };
  return body.conversations.map((conversation) => conversation.conversation_id);
}

function headers(userId: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'idempotency-key': `coworker-owner-${userId}`,
    'x-agent-server-user-id': userId,
  };
}

function config(): AppConfig {
  return {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 3000,
    logLevel: 'error',
    serviceName: 'coworker-owner-test',
    directChatPlane: 'execution_runtime',
    productWorkSurface: 'composed',
    teamCompletionApprovalRequired: false,
    skillRegistryRoot: '/tmp/coworker-owner-test',
    chat: { activationBurstDebounceMs: 2_000 },
    serviceAccounts: [
      {
        serviceAccountId,
        token,
        tenantId,
        workspaceId,
        policyVersion: 'policy-coworker-owner',
        disabled: false,
      },
    ],
    paseo: {
      wsUrl: 'ws://127.0.0.1:6767/ws',
      agentCwd: '/tmp/coworker-owner-test',
      provider: 'opencode',
      workspaceTitle: 'Coworker Owner Test',
      connectTimeoutMs: 1000,
      connectTimeoutSource: 'default',
      executionTimeoutMs: 1000,
      executionTimeoutSource: 'default',
      sessionRpcTimeoutMs: 2000,
      sessionRpcTimeoutSource: 'default',
    },
  } as AppConfig;
}
