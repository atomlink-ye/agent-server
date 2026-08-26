import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createManagedAgentDefinition } from '../../src/domain/agents/managed-agent-definition.js';
import { parseManagedAgentPackage } from '../../src/domain/agents/managed-agent-package.js';
import { createManagedAgentDraft } from '../../src/domain/agents/managed-agent-version.js';
import { PostgresAgentRegistry } from '../../src/infrastructure/postgres/postgres-agent-registry.js';
import { PostgresConversationRepository } from '../../src/infrastructure/postgres/postgres-conversation-repository.js';
import { PostgresRuntimeSessionStore } from '../../src/infrastructure/postgres/runtime/postgres-runtime-session-store.js';
import { PostgresRuntimeGrantAuthority } from '../../src/infrastructure/postgres/runtime/postgres-runtime-grant-authority.js';
import { PostgresRuntimeSpecStore } from '../../src/infrastructure/postgres/runtime/postgres-runtime-spec-store.js';
import {
  runtimeSpecRevision,
  type RuntimeScope,
} from '../../src/domain/runtime/runtime-session.js';
import { createRuntimeSessionSpec } from '../../src/domain/runtime/runtime-session-spec.js';
import {
  applyDurableKernelMigrations,
  createPostgresPool,
} from '../../src/infrastructure/postgres/postgres.js';

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!connectionString) {
  throw new Error(
    'runtime-session-agent-chat-real-pg requires DATABASE_URL or POSTGRES_URL',
  );
}

const tenantId = 'tenant_runtime_chat_epoch';
const workspaceId = '71000000-0000-4000-8000-000000000101';
const principalType = 'service_account' as const;
const principalId = 'principal_runtime_chat_epoch';
const definitionId = '71000000-0000-4000-8000-000000000001';
const proposedDefinitionIdV2 = '71000000-0000-4000-8000-000000000002';
const versionIdV1 = '72000000-0000-4000-8000-000000000001';
const versionIdV2 = '72000000-0000-4000-8000-000000000002';
const fixedTime = () => new Date('2026-08-22T08:00:00.000Z');
const owner = {
  tenantId,
  workspaceId,
  principalType,
  principalId,
};

const pool = createPostgresPool({ connectionString });
const registry = new PostgresAgentRegistry(pool);
const conversations = new PostgresConversationRepository(pool);
const runtimeSessions = new PostgresRuntimeSessionStore(
  pool,
  new PostgresRuntimeGrantAuthority(pool),
);
const runtimeSpecs = new PostgresRuntimeSpecStore(pool);

beforeAll(async () => {
  await applyDurableKernelMigrations(pool);
  await pool.query(
    `INSERT INTO workspaces
       (id,tenant_id,principal_type,principal_id,name,created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$6)
     ON CONFLICT (id) DO NOTHING`,
    [
      workspaceId,
      tenantId,
      principalType,
      principalId,
      'Agent Chat Runtime Epoch Workspace',
      fixedTime().toISOString(),
    ],
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM runtime_sessions WHERE tenant_id=$1', [
    tenantId,
  ]);
  await pool.query('DELETE FROM agent_chat_runtimes WHERE tenant_id=$1', [
    tenantId,
  ]);
  await pool.query(
    'DELETE FROM agent_registry_idempotency WHERE tenant_id=$1',
    [tenantId],
  );
  await pool.query('DELETE FROM agent_versions WHERE tenant_id=$1', [tenantId]);
  await pool.query('DELETE FROM agent_definitions WHERE tenant_id=$1', [
    tenantId,
  ]);
  await pool.query('DELETE FROM workspaces WHERE id=$1', [workspaceId]);
  await pool.end();
});

describe('Agent Chat RuntimeSession normalized scope persistence on real PostgreSQL', () => {
  it('reuses one epoch session, rotates cleanly, and keeps version pins stable', async () => {
    const v1 = await importDraft({
      source: source('first capability'),
      definitionId,
      versionId: versionIdV1,
      importKey: 'runtime-chat-import-v1',
    });
    const publishedV1 = await registry.publishAgentVersion({
      owner,
      idempotencyKey: 'runtime-chat-publish-v1',
      requestFingerprint: v1.fingerprint,
      versionId: v1.id,
    });
    const chatV1 = await conversations.getChatRuntime({
      tenantId,
      agentDefinitionId: definitionId,
    });
    expect(chatV1).toMatchObject({
      agentDefinitionId: definitionId,
      activeAgentVersionId: publishedV1.id,
      epoch: 1,
    });
    expect(chatV1?.id).toMatch(/^[0-9a-f-]{36}$/i);

    const first = await runtimeSessions.createWithInitialSpec({
      owner,
      scope: agentChatScope(chatV1!.id, chatV1!.epoch),
      spec: runtimeSpec(publishedV1.id),
    });
    const replay = await runtimeSessions.createWithInitialSpec({
      owner,
      scope: agentChatScope(chatV1!.id, chatV1!.epoch),
      spec: runtimeSpec(publishedV1.id),
    });
    expect(replay.id).toBe(first.id);
    expect(first.scope).toEqual({
      kind: 'agent_chat',
      id: chatV1!.id,
      epoch: 1,
    });
    expect(first.desiredSpecRevision).toBe(1);
    expect(first.status).toBe('provisioning');
    expect(first.currentGenerationId).toBeNull();

    const firstSpec = await runtimeSpecs.get(
      first.id,
      first.desiredSpecRevision,
    );
    expect(firstSpec).toMatchObject({
      runtimeSessionId: first.id,
      revision: 1,
      workspaceId,
      agentVersionId: publishedV1.id,
    });

    const v2 = await importDraft({
      source: source('second capability'),
      definitionId: proposedDefinitionIdV2,
      versionId: versionIdV2,
      importKey: 'runtime-chat-import-v2',
    });
    expect(v2.definitionId).toBe(definitionId);
    const publishedV2 = await registry.publishAgentVersion({
      owner,
      idempotencyKey: 'runtime-chat-publish-v2',
      requestFingerprint: v2.fingerprint,
      versionId: v2.id,
    });
    const chatV2 = await conversations.getChatRuntime({
      tenantId,
      agentDefinitionId: definitionId,
    });
    expect(chatV2).toMatchObject({
      id: chatV1!.id,
      activeAgentVersionId: publishedV2.id,
      epoch: 2,
    });

    const rotated = await runtimeSessions.createWithInitialSpec({
      owner,
      scope: agentChatScope(chatV2!.id, chatV2!.epoch),
      spec: runtimeSpec(publishedV2.id),
    });
    expect(rotated.id).not.toBe(first.id);
    expect(rotated.scope).toEqual({
      kind: 'agent_chat',
      id: chatV2!.id,
      epoch: 2,
    });
    expect(rotated.desiredSpecRevision).toBe(1);
    expect(
      (await runtimeSpecs.get(rotated.id, rotated.desiredSpecRevision))
        ?.agentVersionId,
    ).toBe(publishedV2.id);

    const historical = await runtimeSessions.findByScope(
      owner,
      agentChatScope(chatV1!.id, 1),
    );
    expect(historical?.id).toBe(first.id);
    expect(
      (await runtimeSpecs.get(first.id, first.desiredSpecRevision))
        ?.agentVersionId,
    ).toBe(publishedV1.id);

    const persisted = await pool.query<{
      scope_kind: string;
      scope_id: string;
      scope_epoch: number;
      desired_spec_revision: number;
      status: string;
      current_generation_id: string | null;
    }>(
      `SELECT scope_kind,scope_id,scope_epoch,desired_spec_revision,status,
              current_generation_id
         FROM runtime_sessions
        WHERE tenant_id=$1 AND scope_kind='agent_chat'
        ORDER BY scope_epoch ASC`,
      [tenantId],
    );
    expect(persisted.rows).toEqual([
      {
        scope_kind: 'agent_chat',
        scope_id: chatV1!.id,
        scope_epoch: 1,
        desired_spec_revision: 1,
        status: 'provisioning',
        current_generation_id: null,
      },
      {
        scope_kind: 'agent_chat',
        scope_id: chatV1!.id,
        scope_epoch: 2,
        desired_spec_revision: 1,
        status: 'provisioning',
        current_generation_id: null,
      },
    ]);
  });
});

function agentChatScope(id: string, epoch: number): RuntimeScope {
  return { kind: 'agent_chat', id, epoch };
}

function runtimeSpec(agentVersionId: string) {
  return createRuntimeSessionSpec({
    runtimeSessionId:
      crypto.randomUUID() as import('../../src/domain/runtime/runtime-session.js').RuntimeSessionId,
    revision: runtimeSpecRevision(1),
    workspaceId,
    agentVersionId,
    environmentVersionId: null,
    resolvedSkills: [],
    toolRefs: [],
    provider: 'paseo',
    model: null,
    cwd: '/workspace',
    systemPromptDigest: 'system-prompt-digest',
    skillSetDigest: 'skill-set-digest',
    toolCatalogDigest: 'tool-catalog-digest',
    extensionSetDigest: 'extension-set-digest',
    contextEpoch: 1,
    createdAt: fixedTime().toISOString(),
  });
}

async function importDraft(input: {
  readonly source: string;
  readonly definitionId: string;
  readonly versionId: string;
  readonly importKey: string;
}) {
  const parsed = parseManagedAgentPackage(input.source);
  const definition = createManagedAgentDefinition({
    ...owner,
    id: input.definitionId,
    normalizedName: parsed.normalizedName,
    displayName: 'Runtime Chat Epoch Agent',
    now: fixedTime,
  });
  const draft = createManagedAgentDraft({
    definition,
    parsed,
    id: input.versionId,
    now: fixedTime,
  });
  const result = await registry.importAgent({
    owner,
    idempotencyKey: input.importKey,
    requestFingerprint: parsed.fingerprint,
    normalizedName: definition.normalizedName,
    definition,
    version: draft,
  });
  return result.version;
}

function source(description: string): string {
  return `apiVersion: agent-server/v1alpha1
kind: ManagedAgent
metadata:
  name: Runtime Chat Epoch Agent
spec:
  description: ${description}
  instructions: Keep the coworker relationship stable while capability versions change.
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
