import { describe, expect, it } from 'vitest';

import type { ReadinessProbe } from '../../../application/health/readiness.js';
import type { RuntimeExecutionProvider } from '../../../application/ports/runtime-execution-provider.js';
import type { GetRun } from '../../../application/runs/get-run.js';
import type { SubmitRun } from '../../../application/runs/submit-run.js';
import type { GetTask } from '../../../application/tasks/get-task.js';
import type { GetTaskTree } from '../../../application/tasks/get-task-tree.js';
import type { InvokeTask } from '../../../application/tasks/invoke-task.js';
import { createRun } from '../../../domain/runs/run.js';
import { createHttpApp } from '../app.js';

describe('run routes', () => {
  it('admits work without directly coupling the route to inline execution', async () => {
    const run = createRun('same prompt', {
      id: '00000000-0000-4000-8000-000000000001',
      now: () => new Date('2026-07-22T12:00:00.000Z'),
    });
    const executeCalls: string[] = [];
    let submitCalls = 0;

    const app = createHttpApp({
      config: {
        nodeEnv: 'test',
        host: '127.0.0.1',
        port: 3_000,
        logLevel: 'error',
        serviceName: 'agent-server-test',
        directChatPlane: 'execution_runtime',
        productWorkPlane: 'execution_runtime',
        productWorkAvailability: { surface: 'composed', execution: 'runtime' },
        teamCompletionApprovalRequired: false,
        skillRegistryRoot: '/tmp/agent-server-test/skill-registry',
        serviceAccounts: [
          {
            serviceAccountId: 'svc_enabled',
            token: 'token-enabled',
            tenantId: 'tenant_alpha',
            workspaceId: 'workspace_main',
            policyVersion: 'policy-2026-07-22',
            disabled: false,
          },
        ],
        paseo: {
          wsUrl: 'ws://127.0.0.1:6767/ws',
          agentCwd: '/tmp/agent-server-test',
          provider: 'opencode',
          workspaceTitle: 'Agent Server Test',
          connectTimeoutMs: 1_000,
          connectTimeoutSource: 'default',
          executionTimeoutMs: 1_000,
          executionTimeoutSource: 'default',
          sessionRpcTimeoutMs: 2_000,
          sessionRpcTimeoutSource: 'default',
        },
      },
      logger: { log: () => undefined },
      readiness: { check: async () => [] } satisfies ReadinessProbe,
      runtime: createRuntimeStub(),
      submitRun: {
        execute: async () => ({ run, reused: submitCalls++ > 0 }),
        replayIfAccepted: async () => null,
      } as unknown as SubmitRun,
      getRun: {
        execute: async () => null,
      } as unknown as GetRun,
      invokeTask: {
        execute: async () => {
          throw new Error('not implemented in run route tests');
        },
      } as unknown as InvokeTask,
      getTask: {
        execute: async () => null,
      } as unknown as GetTask,
      getTaskTree: {
        execute: async () => null,
      } as unknown as GetTaskTree,
      teamExecutions: {} as never,
      teamDriver: {} as never,
      teamMessages: {} as never,
      tasks: {} as never,
      sessions: {} as never,
      submitSessionTurn: {} as never,
      events: {} as never,
      cancelTask: {} as never,
      memoryModule: { installHttp() {} },
      resourceModule: {
        installHttp() {},
        installProductWorkHttp() {},
        managedAgentDefinitions: {
          findDefinition: async () => null,
          findManagedDefinitionByTenant: async () => null,
          findVersionByTenant: async () => null,
          listVersionsByTenant: async () => ({ items: [], nextCursor: null }),
        },
      },
    });

    const headers = {
      authorization: 'Bearer token-enabled',
      'content-type': 'application/json',
      'idempotency-key': 'same-key',
    };

    const first = await app.request('/api/v1/runs', {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt: 'same prompt' }),
    });
    const second = await app.request('/api/v1/runs', {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt: 'same prompt' }),
    });

    await flushAsyncWork();

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(executeCalls).toEqual([]);
  });
});

function createRuntimeStub(): Pick<RuntimeExecutionProvider, 'health'> {
  return {
    async health() {
      return {
        ready: true,
        plane: 'paseo',
        provider: 'opencode',
        model: 'opencode/fake-free',
        checks: [],
      };
    },
  };
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
