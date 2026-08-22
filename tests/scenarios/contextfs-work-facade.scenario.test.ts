import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import {
  AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF,
  AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF,
} from '../../src/application/agents/built-in-skills.js';
import { RuntimeMcpServer } from '../../src/infrastructure/extensions/runtime-mcp-server.js';
import { RuntimeToolRegistry } from '../../src/platform/runtime-tool-registry.js';
import {
  createAgentServerHarness,
  type AgentServerHarness,
} from '../harness/agent-server-harness.js';

const harnesses: AgentServerHarness[] = [];
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.dispose()));
});

describe('ContextFS + WorkExecutionService host scenario', () => {
  it('starts Work, admits bounded Conversation input, and reads product state without Task/Run APIs', async () => {
    const h = await createAgentServerHarness();
    harnesses.push(h);
    const world = await h.seed.goldenPath({
      tenantId: 'tenant-context-facade',
      principalId: 'principal-context-facade',
      name: 'Context Facade',
    });
    const product = h.work.scenario(world);
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
    const grant = await mcp.grants.issue({
      tenantId: world.owner.tenantId,
      workspaceId: world.owner.workspaceId,
      principalType: world.owner.principalType,
      principalId: world.owner.principalId,
      scopeId: 'context-facade-runtime',
      allowedTools: [
        AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF,
        AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF,
      ],
    });
    const created = await h.runtime.createSession({
      runtimeSessionId: 'context-facade-runtime',
      systemPrompt: `Agent definition ID: ${world.agent.definitionId}`,
      mcpServer: mcp,
      token: grant.token,
    });
    await created.session.run({
      runId: randomUUID(),
      prompt: '请正式分析 OpenAI、Anthropic、Google',
    });

    const works = await h.db.query<{ id: string }>(
      'SELECT id FROM works WHERE tenant_id=$1',
      [world.owner.tenantId],
    );
    expect(works.rows).toHaveLength(1);
    const workId = works.rows[0]!.id;

    const admitted = await h.db.query<{
      path: string;
      content: string;
    }>(
      `SELECT path,content FROM context_entries
       WHERE tenant_id=$1 AND scope_kind='work' AND scope_key=$2`,
      [world.owner.tenantId, `${world.owner.workspaceId}:${workId}`],
    );
    expect(admitted.rows).toHaveLength(1);
    expect(admitted.rows[0]?.path).toBe('input/conversation.json');
    expect(JSON.parse(admitted.rows[0]!.content)).toEqual({
      conversation_id: world.conversation.id,
      trigger_message_id: world.triggerMessageId,
    });

    const state = await product.workModule.execution.getWorkState({
      accessContext: {
        ...world.owner,
        policySnapshotVersion: 'scenario-policy-v1',
      },
      workId,
    });
    expect(state.work.id).toBe(workId);
    expect(state.currentWorkRun?.workId).toBe(workId);
    expect('taskId' in (state as any)).toBe(false);
    expect('runId' in (state as any)).toBe(false);

    const workerView = product.workModule.contextViews.forWorker({
      productScope: {
        tenantId: world.owner.tenantId,
        workspaceId: world.owner.workspaceId,
      },
      agentDefinitionId: world.agent.definitionId,
      workId,
    });
    expect(workerView.mounts.some((mount) => mount.mountPath === '/work')).toBe(
      true,
    );
    expect(
      workerView.mounts.some((mount) => mount.mountPath === '/conversation'),
    ).toBe(false);
  });
});
