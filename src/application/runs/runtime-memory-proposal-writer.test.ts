import { describe, expect, it, vi } from 'vitest';

import type { Run } from '../../domain/runs/run.js';
import type { Task } from '../../domain/tasks/task.js';
import type { ClaimedRun } from '../ports/run-repository.js';
import { RuntimeMemoryPersistenceError } from './runtime-execution-receipt.js';
import { RuntimeMemoryProposalWriter } from './runtime-memory-proposal-writer.js';

const runningRun = {
  id: 'run-1',
  prompt: 'prompt',
  status: 'running',
  createdAt: '2026-08-15T00:00:00.000Z',
  updatedAt: '2026-08-15T00:00:00.000Z',
} as Run;

const claim = {
  run: runningRun,
  taskId: 'task-1',
} as ClaimedRun;

const task = {
  id: 'task-1',
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  principalType: 'service_account',
  principalId: 'principal-1',
  policySnapshotVersion: 'policy-1',
  sessionId: 'session-1',
  sourceMessageId: 'message-1',
} as Task;

const execution = {
  provider: 'test-provider',
  model: 'test-model',
  text: 'result',
  workspaceBinding: {
    plane: 'test-plane',
    externalWorkspaceId: 'workspace-external',
  },
  sessionBinding: {
    plane: 'test-plane',
    externalSessionId: 'session-external',
  },
  memoryCandidates: [
    { category: 'terminology', content: 'Use Work for the durable unit.' },
    { category: 'terminology', content: 'api_key = secret-value' },
    { category: 'unsupported', content: 'ignore me' },
  ],
} as const;

describe('RuntimeMemoryProposalWriter', () => {
  it('persists only safe bounded candidates with durable provenance', async () => {
    const executeBatch = vi.fn(async () => undefined);
    const writer = new RuntimeMemoryProposalWriter(
      { execute: vi.fn(), executeBatch } as never,
      { log: vi.fn() },
    );

    await writer.write({
      claim,
      task,
      agentVersionId: 'agent-version-1',
      proposalLimit: 3,
      execution,
    });

    expect(executeBatch).toHaveBeenCalledTimes(1);
    expect(executeBatch).toHaveBeenCalledWith([
      expect.objectContaining({
        content: 'Use Work for the durable unit.',
        category: 'terminology',
        sourceTaskId: 'task-1',
        sourceSessionId: 'session-1',
        sourceMessageId: 'message-1',
        sourceRunId: 'run-1',
        sourceAgentVersionId: 'agent-version-1',
        sourceCandidateIndex: 0,
      }),
    ]);
  });

  it('does not create proposals without a source message', async () => {
    const executeBatch = vi.fn(async () => undefined);
    const writer = new RuntimeMemoryProposalWriter(
      { execute: vi.fn(), executeBatch } as never,
      { log: vi.fn() },
    );

    await writer.write({
      claim,
      task: { ...task, sourceMessageId: null } as Task,
      agentVersionId: 'agent-version-1',
      proposalLimit: 3,
      execution,
    });

    expect(executeBatch).not.toHaveBeenCalled();
  });

  it('keeps a succeeded runtime receipt when proposal persistence fails', async () => {
    const writer = new RuntimeMemoryProposalWriter(
      {
        execute: vi.fn(),
        executeBatch: vi.fn(async () => {
          throw new Error('database unavailable');
        }),
      } as never,
      { log: vi.fn() },
      () => new Date('2026-08-15T00:00:01.000Z'),
    );

    await expect(
      writer.write({
        claim,
        task,
        agentVersionId: 'agent-version-1',
        proposalLimit: 1,
        execution,
      }),
    ).rejects.toBeInstanceOf(RuntimeMemoryPersistenceError);
  });
});
