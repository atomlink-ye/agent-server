import { PGlite } from '@electric-sql/pglite';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';

import { PostgresChatDispatchRepository } from '../../src/infrastructure/postgres/postgres-chat-dispatch-repository.js';
import { PostgresConversationRepository } from '../../src/infrastructure/postgres/postgres-conversation-repository.js';
import { PostgresConversationWorkEntitlementRepository } from '../../src/infrastructure/postgres/postgres-conversation-work-entitlement-repository.js';
import { PostgresWorkspaceMembershipRepository } from '../../src/infrastructure/postgres/postgres-workspace-membership-repository.js';
import { PostgresAgentRegistry } from '../../src/infrastructure/postgres/postgres-agent-registry.js';
import { applyDurableKernelMigrations } from '../../src/infrastructure/postgres/postgres.js';
import { registerConversationRoutes } from '../../src/entrypoints/api/routes/conversations.js';
import { HttpError } from '../../src/contracts/http.js';
import type { ApiEnvironment } from '../../src/entrypoints/api/http-types.js';
import type { AppConfig } from '../../src/shared/config.js';

const token = 'human-principal-token';
const tenantId = 'tenant_human_principal';
const workspaceId = 'a1000000-0000-4000-8000-000000000101';
const serviceAccountId = 'svc_human_principal';
const definitionId = 'a2000000-0000-4000-8000-000000000001';
const versionId = 'a3000000-0000-4000-8000-000000000001';
const now = '2026-09-07T12:00:00.000Z';

const CANARY = 'SECRET-CANARY-A-ONLY-do-not-leak';

let database: PGlite | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

describe('conversations belong to the person who opened them', () => {
  it('scopes every read to the requesting human and still grants them Work context', async () => {
    const app = await workspaceWithOneCoworker();

    const personA = await openCoworkerConversation('person-a');
    const personB = await openCoworkerConversation('person-b');

    expect(personB).not.toBe(personA);

    const posted = await app.request(
      `/api/v1/conversations/${personA}/messages`,
      {
        method: 'POST',
        headers: headers('person-a'),
        body: JSON.stringify({ body: CANARY }),
      },
    );
    expect(posted.status).toBe(202);

    // 1. The list is the requester's own, never anybody else's.
    expect(await listConversationIds(app, 'person-a')).toEqual([personA]);
    expect(await listConversationIds(app, 'person-b')).toEqual([personB]);

    // 2. Reaching for another person's conversation id is refused, so the
    //    canary is unreachable even when its address is known.
    const stolen = await app.request(`/api/v1/conversations/${personA}`, {
      headers: headers('person-b'),
    });
    expect(stolen.status).toBe(404);
    const stolenMessages = await app.request(
      `/api/v1/conversations/${personA}/messages`,
      { headers: headers('person-b') },
    );
    expect(stolenMessages.status).toBe(404);
    expect(await stolenMessages.text()).not.toContain(CANARY);

    // 3. The owner still reads their own message.
    const own = await app.request(`/api/v1/conversations/${personA}/messages`, {
      headers: headers('person-a'),
    });
    expect(own.status).toBe(200);
    expect(await own.text()).toContain(CANARY);

    // 4. Both people were admitted to the workspace as themselves.
    const members = await database!.query<{
      principal_type: string;
      principal_id: string;
    }>(
      `SELECT principal_type,principal_id FROM workspace_members
        WHERE tenant_id=$1 AND workspace_id=$2
        ORDER BY principal_type,principal_id`,
      [tenantId, workspaceId],
    );
    expect(members.rows).toEqual([
      { principal_type: 'service_account', principal_id: serviceAccountId },
      { principal_type: 'user', principal_id: 'person-a' },
      { principal_type: 'user', principal_id: 'person-b' },
    ]);

    // 5. A human-owned conversation carries Work context, and the chat turn
    //    resolves it -- this is what keeps Agent-calls-Work alive in chat once
    //    conversations stop belonging to the service account.
    const entitlements = new PostgresConversationWorkEntitlementRepository(
      database!,
    );
    const resolved = await entitlements.resolveForChatTurn({
      tenantId,
      conversationId: personA,
      agentDefinitionId: definitionId,
    });
    expect(resolved).toMatchObject({
      conversationId: personA,
      workspaceId,
      principalType: 'user',
      principalId: 'person-a',
    });

    // 6. Work still resolves into the shared workspace, not a private one, so
    //    Boards and Work items stay the team's.
    expect(resolved?.workspaceId).toBe(workspaceId);
  });

  it('keeps the service account working when no human is behind the request', async () => {
    const app = await workspaceWithOneCoworker();

    const created = await app.request('/api/v1/conversations', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ agent_definition_id: definitionId }),
    });
    expect(created.status).toBe(201);
    const conversationId = conversationIdOf(await created.json());

    const entitlement = await new PostgresConversationWorkEntitlementRepository(
      database!,
    ).resolveForChatTurn({
      tenantId,
      conversationId,
      agentDefinitionId: definitionId,
    });
    expect(entitlement).toMatchObject({
      principalType: 'service_account',
      principalId: serviceAccountId,
      workspaceId,
    });
  });
});

async function workspaceWithOneCoworker(): Promise<Hono<ApiEnvironment>> {
  database = new PGlite();
  await applyDurableKernelMigrations(database);
  await database.query(
    `INSERT INTO workspaces
       (id,tenant_id,principal_type,principal_id,name,created_at,updated_at)
     VALUES($1,$2,'service_account',$3,$4,$5,$5)`,
    [workspaceId, tenantId, serviceAccountId, 'Human Principal Workspace', now],
  );
  await database.query(
    `INSERT INTO agent_definitions
       (id,tenant_id,workspace_id,principal_type,principal_id,name,
        managed_discriminator,normalized_name,created_at,updated_at)
     VALUES($1,$2,$3,'service_account',$4,'Roster Coworker','managed_agent_v1',
            'roster-coworker',$5,$5)`,
    [definitionId, tenantId, workspaceId, serviceAccountId, now],
  );
  await database.query(
    `INSERT INTO agent_chat_runtimes
       (tenant_id,agent_definition_id,active_agent_version_id,epoch,status,
        created_at,updated_at)
     VALUES($1,$2,$3,1,'available',$4,$4)`,
    [tenantId, definitionId, versionId, now],
  );

  const app = new Hono<ApiEnvironment>();
  // Mirrors the production app's error mapping so a refusal surfaces as the
  // status a browser would actually see instead of an unhandled 500.
  app.onError((error, context) => {
    if (error instanceof HttpError)
      return context.json(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    throw error;
  });
  registerConversationRoutes(app, {
    config: config(),
    conversations: new PostgresConversationRepository(database),
    dispatches: new PostgresChatDispatchRepository(database),
    managedAgentDefinitions: new PostgresAgentRegistry(database),
    workEntitlements: new PostgresConversationWorkEntitlementRepository(
      database,
    ),
    workspaceMembers: new PostgresWorkspaceMembershipRepository(database),
  });
  currentApp = app;
  return app;
}

let currentApp: Hono<ApiEnvironment> | undefined;

async function openCoworkerConversation(userId: string): Promise<string> {
  const response = await currentApp!.request('/api/v1/conversations', {
    method: 'POST',
    headers: headers(userId),
    body: JSON.stringify({ agent_definition_id: definitionId }),
  });
  expect(response.status).toBe(201);
  return conversationIdOf(await response.json());
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

function conversationIdOf(body: unknown): string {
  return (body as { conversation: { conversation_id: string } }).conversation
    .conversation_id;
}

function headers(userId: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'x-agent-server-user-id': userId,
  };
}

function config(): AppConfig {
  return {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 3000,
    logLevel: 'error',
    serviceName: 'human-principal-test',
    directChatPlane: 'execution_runtime',
    productWorkSurface: 'composed',
    teamCompletionApprovalRequired: false,
    skillRegistryRoot: '/tmp/human-principal-test',
    chat: { activationBurstDebounceMs: 2_000 },
    serviceAccounts: [
      {
        serviceAccountId,
        token,
        tenantId,
        workspaceId,
        policyVersion: 'policy-human-principal',
        disabled: false,
      },
    ],
    paseo: {
      wsUrl: 'ws://127.0.0.1:6767/ws',
      agentCwd: '/tmp/human-principal-test',
      provider: 'opencode',
      workspaceTitle: 'Human Principal Test',
      connectTimeoutMs: 1000,
      connectTimeoutSource: 'default',
      executionTimeoutMs: 1000,
      executionTimeoutSource: 'default',
      sessionRpcTimeoutMs: 2000,
      sessionRpcTimeoutSource: 'default',
    },
  } as AppConfig;
}
