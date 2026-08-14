import { describe, expect, it } from 'vitest';

import type {
  CreatedExecutionSession,
  ExecutionPlanePort,
  ExecutionSession,
  ExecutionSessionBinding,
  ExecutionSessionSpec,
} from '../ports/execution-plane.js';
import type { RuntimeSession } from '../ports/runtime-session-repository.js';
import { ExecutionSessionResolver } from './execution-session-resolver.js';

function unboundRuntimeSession(): RuntimeSession {
  return {
    id: 'runtime-session-1',
    scopeKind: 'product_session',
    scopeId: 'product-session-1',
    productSessionId: 'product-session-1',
    taskId: null,
    launchSnapshotId: 'snapshot-1',
    workspaceId: 'workspace-1',
    agentVersionId: 'agent-version-1',
    environmentVersionId: 'environment-version-1',
    resolvedSkills: [],
    toolRefs: [],
    workspaceBinding: null,
    sessionBinding: null,
    paseoWorkspaceId: null,
    providerAgentId: null,
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
  };
}

const spec = {
  workspace: { cwd: '/tmp/runtime-cell' },
  provider: 'opencode',
  model: 'free/model',
  systemPrompt: 'system',
} as const;

function createSessionHandle(
  calls: string[],
  binding: ExecutionSessionBinding = {
    plane: 'paseo',
    externalSessionId: 'external-session-1',
  },
): ExecutionSession {
  return {
    capabilities: { supported: new Set() },
    run: async () => {
      calls.push('run');
      return {
        status: 'completed',
        output: { provider: 'opencode', model: 'free/model', text: 'done' },
      };
    },
    close: async () => {
      calls.push(`close:${binding.externalSessionId}`);
    },
  };
}

function fakePlane(calls: string[]): ExecutionPlanePort {
  return {
    capabilities: () => ({ supported: new Set() }),
    createSession: async (_spec: ExecutionSessionSpec): Promise<CreatedExecutionSession> => {
      calls.push('create');
      return {
        workspaceBinding: {
          plane: 'paseo',
          externalWorkspaceId: 'external-workspace-1',
        },
        sessionBinding: {
          plane: 'paseo',
          externalSessionId: 'external-session-1',
        },
        session: createSessionHandle(calls),
      };
    },
    attachSession: async () => {
      calls.push('attach');
      return createSessionHandle(calls);
    },
    health: async () => ({ ready: true, plane: 'paseo', checks: [] }),
    close: async () => undefined,
  };
}

describe('ExecutionSessionResolver', () => {
  it('creates, persists both bindings, then allows the first prompt', async () => {
    const calls: string[] = [];
    const runtime = unboundRuntimeSession();
    const resolver = new ExecutionSessionResolver(fakePlane(calls), {
      bindExecution: async (binding) => {
        calls.push('persist');
        return {
          ...runtime,
          workspaceBinding: binding.workspaceBinding,
          sessionBinding: binding.sessionBinding,
          paseoWorkspaceId: binding.workspaceBinding.externalWorkspaceId,
          providerAgentId: binding.sessionBinding.externalSessionId,
        };
      },
    });

    const resolved = await resolver.resolve({ runtimeSession: runtime, spec });
    expect(calls).toEqual(['create', 'persist']);

    await resolved.session.run({ runId: 'run-1', prompt: 'first prompt' });
    expect(calls).toEqual(['create', 'persist', 'run']);
  });

  it('never sends the first prompt when durable binding persistence fails', async () => {
    const calls: string[] = [];
    const resolver = new ExecutionSessionResolver(fakePlane(calls), {
      bindExecution: async () => {
        calls.push('persist');
        throw new Error('database unavailable');
      },
    });

    await expect(
      resolver.resolve({ runtimeSession: unboundRuntimeSession(), spec }),
    ).rejects.toThrow('database unavailable');
    expect(calls).toEqual(['create', 'persist', 'close:external-session-1']);
    expect(calls).not.toContain('run');
  });

  it('attaches a fully bound sticky session without creating a replacement', async () => {
    const calls: string[] = [];
    const runtime: RuntimeSession = {
      ...unboundRuntimeSession(),
      workspaceBinding: {
        plane: 'paseo',
        externalWorkspaceId: 'external-workspace-1',
      },
      sessionBinding: {
        plane: 'paseo',
        externalSessionId: 'external-session-1',
      },
      paseoWorkspaceId: 'external-workspace-1',
      providerAgentId: 'external-session-1',
    };
    const resolver = new ExecutionSessionResolver(fakePlane(calls), {
      bindExecution: async () => {
        throw new Error('must not persist on attach');
      },
    });

    const resolved = await resolver.resolve({ runtimeSession: runtime, spec });
    expect(calls).toEqual(['attach']);
    await resolved.session.run({ runId: 'run-2', prompt: 'continue' });
    expect(calls).toEqual(['attach', 'run']);
  });
});
