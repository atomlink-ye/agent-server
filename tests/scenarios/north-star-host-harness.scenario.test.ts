import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import {
  AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF,
  AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF,
} from '../../src/application/agents/built-in-skills.js';
import { CompleteRun } from '../../src/application/runs/complete-run.js';
import { ExecuteRun } from '../../src/application/runs/execute-run.js';
import { ExecuteTeamTask } from '../../src/application/tasks/execute-team-task.js';
import { ChatDeliveryReconciler } from '../../src/application/chat/chat-delivery-reconciler.js';
import { createWorkChatWakeWorker } from '../../src/application/work-chat/work-chat-wake-worker.js';
import { ExecutionRuntimeChatTurnProvider } from '../../src/adapters/chat/execution-runtime-chat-turn-provider.js';
import { transitionRun } from '../../src/domain/runs/run.js';
import { ChatDeliveryWorker } from '../../src/entrypoints/chat/worker.js';
import { LocalRuntimeExtensionBinder } from '../../src/infrastructure/extensions/local-runtime-extension-binder.js';
import { RuntimeMcpServer } from '../../src/infrastructure/extensions/runtime-mcp-server.js';
import { PostgresChatDispatchRepository } from '../../src/infrastructure/postgres/postgres-chat-dispatch-repository.js';
import { PostgresConversationWorkLinkRepository } from '../../src/modules/work/conversation-work-link-repository.js';
import { PostgresRunEventRepository } from '../../src/infrastructure/postgres/postgres-run-event-repository.js';
import { PostgresWorkChatConversationAgentResolver } from '../../src/infrastructure/postgres/postgres-work-chat-conversation-agent-resolver.js';
import { PostgresWorkChatWakeStateRepository } from '../../src/infrastructure/postgres/postgres-work-chat-wake-state-repository.js';
import { PostgresWorkChatWakeWorkSource } from '../../src/infrastructure/postgres/postgres-work-chat-wake-work-source.js';
import { RuntimeToolRegistry } from '../../src/platform/runtime-tool-registry.js';
import { createLogger } from '../../src/shared/observability/logger.js';

import {
  createAgentServerHarness,
  type AgentServerHarness,
} from '../harness/agent-server-harness.js';
import { FakeAgentRuntime } from '../fixtures/fake-agent-runtime.js';
import { HARNESS_NOW } from '../harness/seed/types.js';

const harnesses: AgentServerHarness[] = [];
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.dispose()));
});

async function createHarnessWorld(name: string) {
  const h = await createAgentServerHarness();
  harnesses.push(h);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const world = await h.seed.goldenPath({
    tenantId: `tenant-${slug}`,
    principalId: `principal-${slug}`,
    name,
  });
  const product = h.work.scenario(world);
  return { h, world, product } as const;
}

async function startWorkThroughScriptedRuntime(
  h: AgentServerHarness,
  world: Awaited<ReturnType<AgentServerHarness['seed']['goldenPath']>>,
  product: ReturnType<AgentServerHarness['work']['scenario']>,
  scopeId: string,
) {
  const mcp = h.mcp.track(
    new RuntimeMcpServer(
      new RuntimeToolRegistry([
        (context: any) =>
          product.workModule.contributeRuntime({
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
    scopeId,
    allowedTools: [
      AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF,
      AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF,
    ],
  });
  const created = await h.runtime.createSession({
    runtimeSessionId: scopeId,
    systemPrompt: `Agent definition ID: ${world.agent.definitionId}`,
    mcpServer: mcp,
    token: receipt.token,
  });
  await created.session.run({
    runId: randomUUID(),
    prompt: '请做正式分析 OpenAI、Anthropic、Google',
  });
  const works = await h.db.query<{ id: string }>(
    'SELECT id FROM works WHERE tenant_id=$1 ORDER BY created_at,id',
    [world.owner.tenantId],
  );
  if (works.rows.length !== 1) {
    throw new Error(`expected one Work, received ${works.rows.length}`);
  }
  return { session: created.session, workId: works.rows[0]!.id } as const;
}

describe('North Star host-native deterministic harness', () => {
  it('migrates and seeds the real Golden Path resource graph through semantic fixtures', async () => {
    const { h, world } = await createHarnessWorld('Host Harness');
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
    const entitlement = await h.db.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM conversation_work_entitlements WHERE conversation_id=$1',
      [world.conversation.id],
    );
    expect(entitlement.rows[0]?.count).toBe(1);
  });

  it('creates, links, and continues the same Work through real Product Work MCP handlers', async () => {
    const { h, world, product } = await createHarnessWorld('Host Product');
    const { session, workId } = await startWorkThroughScriptedRuntime(
      h,
      world,
      product,
      'host-harness-product-runtime',
    );

    const firstRuns = await h.db.query<{ work_id: string }>(
      'SELECT work_id FROM work_runs WHERE tenant_id=$1 ORDER BY created_at,id',
      [world.owner.tenantId],
    );
    expect(firstRuns.rows).toEqual([{ work_id: workId }]);
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
        work_id: workId,
        conversation_id: world.conversation.id,
        trigger_message_id: world.triggerMessageId,
      },
    ]);

    await session.run({
      runId: randomUUID(),
      prompt: `继续返工 Work ${workId}: 删除融资部分，多关注技术路线`,
    });

    const works = await h.db.query<{ id: string }>(
      'SELECT id FROM works WHERE tenant_id=$1',
      [world.owner.tenantId],
    );
    expect(works.rows).toEqual([{ id: workId }]);
    const continuedRuns = await h.db.query<{ work_id: string }>(
      'SELECT work_id FROM work_runs WHERE tenant_id=$1 ORDER BY created_at,id',
      [world.owner.tenantId],
    );
    expect(continuedRuns.rows).toHaveLength(2);
    expect(continuedRuns.rows.map((run) => run.work_id)).toEqual([
      workId,
      workId,
    ]);
  });

  it('binds Product Work tools through the real ChatDeliveryReconciler and one worker step', async () => {
    const { h, world, product } = await createHarnessWorld('Host Chat Bridge');
    const dispatches = new PostgresChatDispatchRepository(h.db as any);
    const links = new PostgresConversationWorkLinkRepository(h.db as any);
    const trigger = await h.chat.postConversationMessage(product.conversations, {
      author: {
        type: 'principal',
        tenantId: world.owner.tenantId,
        conversationId: world.conversation.id,
        principalType: world.owner.principalType,
        principalId: world.owner.principalId,
      },
      body: '请做正式分析 OpenAI',
    });
    await dispatches.enqueue({
      tenantId: world.owner.tenantId,
      agentDefinitionId: world.agent.definitionId,
      conversationId: world.conversation.id,
      throughSequence: trigger.sequence,
      dedupeKey: `harness:${trigger.id}`,
    });

    const mcp = h.mcp.track(
      new RuntimeMcpServer(
        new RuntimeToolRegistry([
          (context) => product.workModule.contributeRuntime(context),
        ]),
      ),
    );
    const binder = new LocalRuntimeExtensionBinder(
      process.cwd(),
      process.cwd(),
      mcp,
    );
    const runtime = {
      async executeTurn(input: any) {
        if (!input.extensions) throw new Error('reconciler did not bind extensions');
        const created = await h.runtime.plane.createSession({
          runtimeSessionId: `chat-runtime-${world.conversation.id}`,
          workspace: { cwd: process.cwd() },
          systemPrompt: input.systemPrompt ?? '',
          extensions: input.extensions,
        });
        const result = await created.session.run({
          runId: input.runId,
          prompt: input.prompt,
        });
        if (result.status !== 'completed')
          throw new Error(`scripted execution did not complete: ${result.status}`);
        return {
          provider: result.output.provider,
          model: result.output.model,
          text: result.output.text,
          workspaceBinding: created.workspaceBinding,
          sessionBinding: created.sessionBinding,
        };
      },
    };
    const reconciler = new ChatDeliveryReconciler(
      product.conversations,
      dispatches,
      new ExecutionRuntimeChatTurnProvider(runtime),
      {
        async resolve() {
          return {
            instructions: 'Harness deterministic chat brain',
            capabilitySummary: {},
            agentHome: {},
          } as any;
        },
      } as any,
      links,
      undefined,
      undefined,
      {
        async resolveForChatTurn() {
          return world.entitlement;
        },
      } as any,
      binder,
    );
    const worker = new ChatDeliveryWorker(dispatches, reconciler, {
      workerId: 'host-chat-step',
      leaseMs: 60_000,
    });
    await expect(h.workers.step(worker)).resolves.toMatchObject({
      kind: 'processed',
    });

    const works = await h.db.query<{ id: string }>(
      'SELECT id FROM works WHERE tenant_id=$1',
      [world.owner.tenantId],
    );
    expect(works.rows).toHaveLength(1);
    const linked = await h.db.query<{
      work_id: string;
      conversation_id: string;
      trigger_message_id: string;
    }>(
      'SELECT work_id,conversation_id,trigger_message_id FROM conversation_work_links WHERE tenant_id=$1',
      [world.owner.tenantId],
    );
    expect(linked.rows).toEqual([
      {
        work_id: works.rows[0]!.id,
        conversation_id: world.conversation.id,
        trigger_message_id: trigger.id,
      },
    ]);
  });

  it('persists the WorkRun -> Task -> Run event trace with the real execution repositories', async () => {
    const { h, world, product } = await createHarnessWorld('Host Trace');
    await startWorkThroughScriptedRuntime(
      h,
      world,
      product,
      'host-harness-trace-runtime',
    );
    const binding = await h.db.query<{ work_id: string; root_task_id: string }>(
      'SELECT work_id,root_task_id FROM work_runs WHERE tenant_id=$1',
      [world.owner.tenantId],
    );
    expect(binding.rows).toHaveLength(1);
    const bound = binding.rows[0]!;
    const run = await product.runs.findByTaskId(bound.root_task_id);
    if (!run) throw new Error('expected admitted technical Run');
    const claim = await product.runs.claimQueuedById({
      runId: run.id,
      workerId: 'host-trace-worker',
      activationId: randomUUID(),
      claimedAt: HARNESS_NOW,
      leaseExpiresAt: '2026-08-21T00:01:00.000Z',
    });
    if (!claim) throw new Error('expected technical Run claim');
    await new ExecuteRun(
      new CompleteRun(product.runs, product.tasks),
      product.tasks,
      product.invokables,
      new ExecuteTeamTask(product.invokables, {} as never),
      new FakeAgentRuntime(),
      createLogger({
        service: 'north-star-host-trace',
        minimumLevel: 'error',
        write: () => undefined,
      }),
      undefined,
      undefined,
      new PostgresRunEventRepository(h.db),
    ).execute(claim);

    const trace = await h.db.query<{
      root_task_id: string;
      task_id: string;
      run_id: string;
      event_run_id: string;
      event_count: number;
      event_types: string[];
    }>(
      `SELECT wr.root_task_id,
              t.id AS task_id,
              r.id AS run_id,
              re.run_id AS event_run_id,
              count(re.id)::int AS event_count,
              array_agg(re.type ORDER BY re.sequence) AS event_types
         FROM work_runs wr
         JOIN tasks t ON t.id=wr.root_task_id
         JOIN runs r ON r.task_id=t.id
         JOIN run_events re ON re.run_id=r.id
        WHERE wr.tenant_id=$1
        GROUP BY wr.root_task_id,t.id,r.id,re.run_id`,
      [world.owner.tenantId],
    );
    expect(trace.rows).toHaveLength(1);
    expect(trace.rows[0]?.root_task_id).toBe(trace.rows[0]?.task_id);
    expect(trace.rows[0]?.event_run_id).toBe(trace.rows[0]?.run_id);
    expect(trace.rows[0]?.event_count).toBeGreaterThanOrEqual(1);
    expect(trace.rows[0]?.event_types).toContain('started');
  });

  it('completes a Work task and wakes its linked Chat in one deterministic Work-wake step', async () => {
    const { h, world, product } = await createHarnessWorld('Host Wake');
    const { workId } = await startWorkThroughScriptedRuntime(
      h,
      world,
      product,
      'host-harness-wake-runtime',
    );
    const binding = await h.db.query<{ root_task_id: string }>(
      'SELECT root_task_id FROM work_runs WHERE tenant_id=$1 AND work_id=$2',
      [world.owner.tenantId, workId],
    );
    const rootTaskId = binding.rows[0]?.root_task_id;
    if (!rootTaskId) throw new Error('expected WorkRun root task');
    const run = await product.runs.findByTaskId(rootTaskId);
    if (!run) throw new Error('expected admitted technical Run');
    const claim = await product.runs.claimQueuedById({
      runId: run.id,
      workerId: 'host-completion-worker',
      activationId: randomUUID(),
      claimedAt: HARNESS_NOW,
      leaseExpiresAt: '2026-08-21T00:01:00.000Z',
    });
    if (!claim) throw new Error('expected technical Run claim');
    await new CompleteRun(product.runs, product.tasks).execute({
      claim,
      run: transitionRun(
        claim.run,
        'succeeded',
        { result: { text: 'Harness completed Work result' } },
        () => new Date('2026-08-21T00:00:01.000Z'),
      ),
    });

    const wakeDatabase = {
      query: h.db.query.bind(h.db),
      async connect() {
        return { query: h.db.query.bind(h.db), release() {} };
      },
    };
    const wakeWorker = createWorkChatWakeWorker(
      {
        workSource: new PostgresWorkChatWakeWorkSource(wakeDatabase),
        state: new PostgresWorkChatWakeStateRepository(wakeDatabase),
        projection: product.workModule.createChatWorkCardProjection(),
        conversationWorkLinks: new PostgresConversationWorkLinkRepository(
          h.db as any,
        ),
        conversations: product.conversations,
        conversationAgentDefinitions:
          new PostgresWorkChatConversationAgentResolver(h.db as any),
      },
      {
        workerId: 'host-work-wake-step',
        leaseMs: 60_000,
        now: () => new Date(HARNESS_NOW),
      },
    );
    await expect(h.workers.step(wakeWorker)).resolves.toMatchObject({
      kind: 'processed',
    });

    const task = await h.db.query<{ status: string }>(
      'SELECT status FROM tasks WHERE id=$1',
      [rootTaskId],
    );
    expect(task.rows).toEqual([{ status: 'completed' }]);
    const terminalRun = await h.db.query<{ status: string }>(
      'SELECT status FROM runs WHERE task_id=$1',
      [rootTaskId],
    );
    expect(terminalRun.rows).toEqual([{ status: 'succeeded' }]);
    const messages = await h.db.query<{ work_ref: string }>(
      'SELECT work_ref FROM chat_messages WHERE tenant_id=$1 AND conversation_id=$2 AND work_ref=$3',
      [world.owner.tenantId, world.conversation.id, workId],
    );
    expect(messages.rows).toEqual([{ work_ref: workId }]);
  });
});
