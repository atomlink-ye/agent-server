import { describe, expect, it } from 'vitest';

import type { ReadinessProbe } from '../../../application/health/readiness.js';
import type { CreateMemoryProposal } from '../../../application/memory/create-memory-proposal.js';
import type { ListMemoryEntries } from '../../../application/memory/list-memory-entries.js';
import type { ListMemoryProposals } from '../../../application/memory/list-memory-proposals.js';
import type { ReviewMemoryProposal } from '../../../application/memory/review-memory-proposal.js';
import type {
  AgentRuntimeExecution,
  AgentRuntimeHealth,
  AgentRuntimePort,
} from '../../../application/ports/agent-runtime.js';
import type { AgentRegistry } from '../../../application/ports/agent-registry.js';
import type { GetRun } from '../../../application/runs/get-run.js';
import type { SubmitRun } from '../../../application/runs/submit-run.js';
import type { GetTask } from '../../../application/tasks/get-task.js';
import type { GetTaskTree } from '../../../application/tasks/get-task-tree.js';
import type { InvokeTask } from '../../../application/tasks/invoke-task.js';
import { createRun } from '../../../domain/runs/run.js';
import { createApp } from '../app.js';

describe('run routes', () => {
  it('admits work without directly coupling the route to inline execution', async () => {
    const run = createRun('same prompt', {
      id: '00000000-0000-4000-8000-000000000001',
      now: () => new Date('2026-07-22T12:00:00.000Z'),
    });
    const executeCalls: string[] = [];
    let submitCalls = 0;

    const app = createApp({
      config: {
        nodeEnv: 'test',
        host: '127.0.0.1',
        port: 3_000,
        logLevel: 'error',
        serviceName: 'agent-server-test',
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
          workspaceTitle: 'Agent Server Test',
          connectTimeoutMs: 1_000,
          executionTimeoutMs: 1_000,
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
      createMemoryProposal: {
        execute: async () => {
          throw new Error('not implemented in run route tests');
        },
      } as unknown as CreateMemoryProposal,
      listMemoryProposals: {
        execute: async () => [],
      } as unknown as ListMemoryProposals,
      reviewMemoryProposal: {
        execute: async () => {
          throw new Error('not implemented in run route tests');
        },
      } as unknown as ReviewMemoryProposal,
      listMemoryEntries: {
        execute: async () => [],
      } as unknown as ListMemoryEntries,
      agentRegistry: {
        importAgent: async () => {
          throw new Error('not implemented in run route tests');
        },
        publishAgentVersion: async () => {
          throw new Error('not implemented in run route tests');
        },
        findDefinition: async () => null,
        findVersion: async () => null,
        listVersionsForOwner: async () => null,
      } as AgentRegistry,
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

function createRuntimeStub(): AgentRuntimePort {
  return {
    async initialize(): Promise<void> {
      return undefined;
    },
    async execute(): Promise<AgentRuntimeExecution> {
      throw new Error('not implemented in route tests');
    },
    async health(): Promise<AgentRuntimeHealth> {
      return {
        ready: true,
        provider: 'opencode',
        model: 'opencode/fake-free',
        checks: [],
      };
    },
    async close(): Promise<void> {
      return undefined;
    },
  };
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
