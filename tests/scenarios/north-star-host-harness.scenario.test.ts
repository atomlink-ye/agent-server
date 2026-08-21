import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import {
  AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF,
  AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF,
} from '../../src/application/agents/built-in-skills.js';
import { ResolveWorkDefinition } from '../../src/application/work/resolve-work-definition.js';
import { ChatDeliveryWorker } from '../../src/entrypoints/chat/worker.js';
import { RuntimeMcpServer } from '../../src/infrastructure/extensions/runtime-mcp-server.js';
import { PostgresExecutionFactQuery } from '../../src/infrastructure/postgres/postgres-execution-fact-query.js';
import { PostgresInvokableRepository } from '../../src/infrastructure/postgres/postgres-invokable-repository.js';
import { PostgresWorkDefinitionSourceRepository } from '../../src/infrastructure/postgres/postgres-work-definition-source-repository.js';
import { createWorkModule } from '../../src/modules/work/work-module.js';
import { RuntimeToolRegistry } from '../../src/platform/runtime-tool-registry.js';
import { WorkChatWakeWorker } from '../../src/application/work-chat/work-chat-wake-worker.js';

import {
  createAgentServerHarness,
  type AgentServerHarness,
} from '../harness/agent-server-harness.js';
import { seedActiveTask } from '../harness/seed/index.js';

const harnesses: AgentServerHarness[] = [];
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.dispose()));
});

describe('North Star host-native deterministic harness', () => {
  it('creates the Golden Path world through semantic fixtures', async () => {
    const h = await createAgentServerHarness();
    harnesses.push(h);
    const world = await h.seed.goldenPath({
      tenantId: 'tenant-host-harness',
      principalId: 'principal-host-harness',
      name: 'Host Harness',
    });

    const checks = await Promise.all(
      [
        ['workspaces', world.workspace.id],
        ['environment_versions', world.environment.versionId],
        ['agent_versions', world.agent.versionId],
        ['team_versions', world.team.versionId],
        ['conversations', world.conversation.id],
        ['work_definition_source_versions', world.workDefinition.versionId],
      ].map(async ([table, id]) => {
        const result = await h.db.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM ${table} WHERE id=$1`,
          [id],
        );
        return result.rows[0]?.count ?? 0;
      }),
    );
    expect(checks).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('runs scripted model decisions through real Product Work MCP handlers', async () => {
    const h = await createAgentServerHarness();
    harnesses.push(h);
    const world = await h.seed.goldenPath({
      tenantId: 'tenant-host-product',
      principalId: 'principal-host-product',
      name: 'Host Product',
    });
    const authoredDefinitions = new PostgresWorkDefinitionSourceRepository(h.db);
    const invokables = new PostgresInvokableRepository(h.db);
    const resolver = new ResolveWorkDefinition({
      agents: {
        async findDefinition() {
          return null;
        },
        async findVersion(_owner, id) {
          return id === world.agent.versionId
            ? ({
                id,
                definitionId: world.agent.definitionId,
                tenantId: world.owner.tenantId,
                workspaceId: world.owner.workspaceId,
                principalType: world.owner.principalType,
                principalId: world.owner.principalId,
                status: 'published',
                displayName: 'Host Product Agent',
                fingerprint: `sha256:${'a'.repeat(64)}`,
              } as any)
            : null;
        },
      },
      agentResolution: {
        async resolvePublished(id) {
          return id === world.agent.versionId
            ? {
                source: 'managed' as const,
                id,
                instructions: 'Handle deterministic product work.',
                modelPolicyRef: 'free-only' as const,
                proposalLimit: 0,
                skills: [],
                toolRefs: [],
              }
            : null;
        },
      },
      definitions: invokables,
      authoredDefinitions,
      environments: {
        async findVersion(_owner, id) {
          return id === world.environment.versionId
            ? ({
                id,
                definitionId: world.environment.definitionId,
                tenantId: world.owner.tenantId,
                workspaceId: world.owner.workspaceId,
                principalType: world.owner.principalType,
                principalId: world.owner.principalId,
                status: 'published',
                displayName: 'Host Product Environment',
                package: {},
                canonicalJson: '{}',
                fingerprint: `sha256:${'e'.repeat(64)}`,
                createdAt: '2026-08-21T00:00:00.000Z',
                updatedAt: '2026-08-21T00:00:00.000Z',
                publishedAt: '2026-08-21T00:00:00.000Z',
              } as any)
            : null;
        },
      },
    });
    const workModule = createWorkModule({
      database: h.db as any,
      definitions: invokables,
      definitionResolution: resolver,
      execution: {
        async admitRoot(request: any) {
          return seedActiveTask(h.db, {
            owner: {
              tenantId: request.accessContext.tenantId,
              workspaceId: request.accessContext.workspaceId,
              principalType: request.accessContext.principalType,
              principalId: request.accessContext.principalId,
            },
            policySnapshotVersion: request.accessContext.policySnapshotVersion,
            invokableKind: request.invokable.kind,
            invokableVersionId: request.invokable.versionId,
          });
        },
      } as any,
      runtimeCapabilities: h.runtime.plane,
      executionFacts: new PostgresExecutionFactQuery(h.db as any),
      conversations: {
        async appendMessage() {
          return undefined as any;
        },
      } as any,
    } as any);

    const mcp = h.mcp.track(
      new RuntimeMcpServer(
        new RuntimeToolRegistry([
          (context: any) =>
            workModule.contributeRuntime({
              ...context,
              chatContext: {
                conversationId: world.conversation.id,
                triggerMessageId: world.triggerMessageId,
              },
            }),
        ]),
      ),
    );
    const receipt = mcp.grants.issue({
      tenantId: world.owner.tenantId,
      workspaceId: world.owner.workspaceId,
      principalType: world.owner.principalType,
      principalId: world.owner.principalId,
      scopeId: 'host-harness-chat-runtime',
      allowedTools: [
        AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF,
        AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF,
      ],
    });
    const created = await h.runtime.createSession({
      runtimeSessionId: 'host-harness-chat-runtime',
      systemPrompt: `Agent definition ID: ${world.agent.definitionId}`,
      mcpServer: mcp,
      token: receipt.token,
    });

    await expect(
      created.session.run({
        runId: randomUUID(),
        prompt: '请做正式分析 OpenAI、Anthropic、Google',
      }),
    ).resolves.toMatchObject({ status: 'completed' });

    const works = await h.db.query<{ id: string }>(
      'SELECT id FROM works WHERE tenant_id=$1',
      [world.owner.tenantId],
    );
    expect(works.rows).toHaveLength(1);
    const runs = await h.db.query<{ work_id: string }>(
      'SELECT work_id FROM work_runs WHERE tenant_id=$1',
      [world.owner.tenantId],
    );
    expect(runs.rows).toHaveLength(1);
    expect(runs.rows[0]?.work_id).toBe(works.rows[0]?.id);
    const links = await h.db.query<{
      work_id: string;
      conversation_id: string;
      trigger_message_id: string;
    }>(
      'SELECT work_id,conversation_id,trigger_message_id FROM conversation_work_links WHERE tenant_id=$1',
      [world.owner.tenantId],
    );
    expect(links.rows).toEqual([
      {
        work_id: works.rows[0]?.id,
        conversation_id: world.conversation.id,
        trigger_message_id: world.triggerMessageId,
      },
    ]);
  });

  it('steps chat delivery without starting a polling loop', async () => {
    const claimed = [{ id: 'dispatch-1' }, null] as const;
    const reconciled: unknown[] = [];
    const worker = new ChatDeliveryWorker(
      {
        async claimNext() {
          return claimed.shift?.() as never;
        },
      } as any,
      {
        async reconcile(dispatch) {
          reconciled.push(dispatch);
        },
      } as any,
      { workerId: 'scenario-chat', leaseMs: 1_000 },
    );
    await expect(worker.step()).resolves.toMatchObject({ kind: 'processed' });
    expect(reconciled).toHaveLength(1);
  });

  it('steps Work wake without timers when there is no work', async () => {
    const worker = new WorkChatWakeWorker(
      {
        workSource: {
          async listWorkKeys() {
            return { items: [], nextCursor: null };
          },
        },
        state: {
          async observe() {
            return 'unchanged' as const;
          },
          async claimPending() {
            return null;
          },
          async markDelivered() {},
        },
        projection: {
          async getByWorkId() {
            throw new Error('not reached');
          },
        },
        conversationWorkLinks: {
          async findConversationIdByWork() {
            return null;
          },
        },
        conversations: {
          async appendMessage() {
            throw new Error('not reached');
          },
          async getChatRuntime() {
            return null;
          },
        },
        conversationAgentDefinitions: {
          async resolve() {
            return null;
          },
        },
      } as any,
      { workerId: 'scenario-work-wake', leaseMs: 1_000 },
    );
    await expect(worker.step()).resolves.toEqual({ kind: 'idle' });
  });
});
