import { describe, expect, it, vi } from 'vitest';

import { ContextAwareExecutionRuntime } from './context-aware-execution-runtime.js';
import type { ExecutionRuntimeService } from '../ports/execution-runtime.js';
import type { RuntimeInvocationContext } from '../../domain/runtime/runtime-invocation-context.js';
import { makeRuntimeSession } from '../../../tests/fixtures/runtime-session.js';

const invocationContext: RuntimeInvocationContext = {
  scope: { kind: 'task', taskId: 'task-1' },
  productScope: { tenantId: 'tenant-1', workspaceId: 'workspace-1' },
  actor: { type: 'user', id: 'alice' },
  agentOwner: {
    scope: { tenantId: 'tenant-1', workspaceId: 'workspace-1' },
    principal: { type: 'service_account', id: 'agent-owner' },
  },
  agentDefinitionId: 'agent-1',
  agentVersionId: 'agent-version-1',
  workId: 'work-1',
  workRunId: 'work-run-1',
  contextView: { kind: 'worker', mounts: [] },
};

function baseRuntime() {
  const executeTurn = vi.fn(async () => ({
    provider: 'test',
    model: 'test',
    text: 'ok',
    workspaceBinding: { plane: 'paseo' as const, externalWorkspaceId: 'ws' },
    sessionBinding: { plane: 'paseo' as const, externalSessionId: 'session' },
  }));
  const runtime: ExecutionRuntimeService = {
    ensureAgentChatRuntimeSession: vi.fn(async (input) =>
      makeRuntimeSession({
        id: input.agentChatRuntimeId,
        scope: {
          kind: 'agent_chat',
          agentChatRuntimeId: input.agentChatRuntimeId,
          runtimeEpoch: input.runtimeEpoch,
        },
        scopeKind: 'agent_chat',
        scopeId: `${input.agentChatRuntimeId}:${input.runtimeEpoch}`,
        productSessionId: null,
        environmentVersionId: null,
        workspaceId: input.agentOwner.scope.workspaceId,
        agentVersionId: input.agentVersionId,
        resolvedSkills: input.resolvedSkills,
        toolRefs: input.toolRefs,
      }),
    ),
    ensureReady: vi.fn(async () => true),
    executeTurn,
    cancelRun: vi.fn(async () => undefined),
    planeHealth: vi.fn(async () => ({
      ready: true,
      plane: 'test',
      checks: [],
    })),
    close: vi.fn(async () => undefined),
  };
  return { runtime, executeTurn };
}

describe('ContextAwareExecutionRuntime', () => {
  it('adds a durable Worker invocation context for RuntimeSession-backed turns', async () => {
    const { runtime, executeTurn } = baseRuntime();
    const resolve = vi.fn(async () => invocationContext);
    const decorated = new ContextAwareExecutionRuntime(runtime, { resolve });

    await decorated.executeTurn({
      runId: 'run-1',
      runtimeSessionId: 'runtime-session-1',
      prompt: 'work',
    });

    expect(resolve).toHaveBeenCalledWith('runtime-session-1');
    expect(executeTurn).toHaveBeenCalledWith(
      expect.objectContaining({ invocationContext }),
      undefined,
    );
  });

  it('never overwrites Chat or caller-provided invocation context', async () => {
    const { runtime, executeTurn } = baseRuntime();
    const resolve = vi.fn(async () => invocationContext);
    const decorated = new ContextAwareExecutionRuntime(runtime, { resolve });
    const chatContext: RuntimeInvocationContext = {
      ...invocationContext,
      scope: {
        kind: 'agent_chat',
        agentChatRuntimeId: 'chat-runtime',
        runtimeEpoch: 1,
      },
      conversationId: 'conversation-1',
    };

    await decorated.executeTurn({
      runId: 'run-chat',
      runtimeSessionId: 'chat-session',
      prompt: 'chat',
      invocationContext: chatContext,
    });

    expect(resolve).not.toHaveBeenCalled();
    expect(executeTurn).toHaveBeenCalledWith(
      expect.objectContaining({ invocationContext: chatContext }),
      undefined,
    );
  });
});
