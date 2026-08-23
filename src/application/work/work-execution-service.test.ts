import { describe, expect, it } from 'vitest';

import type { AccessContext } from '../../domain/access-context.js';
import type { Work } from '../../domain/work/work.js';
import type { WorkRun } from '../../domain/work/work-run.js';
import { WorkExecutionService } from './work-execution-service.js';

const accessContext: AccessContext = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  principalType: 'user',
  principalId: 'alice',
  policySnapshotVersion: 'policy-1',
};

const work: Work = {
  id: 'work-1',
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  definitionId: 'definition-1',
  currentDefinitionVersionId: 'definition-version-1',
  title: 'Research',
  origin: 'created',
  archivedAt: null,
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z',
};

const firstRun: WorkRun = {
  id: 'work-run-1',
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  workId: work.id,
  definitionVersionId: work.currentDefinitionVersionId,
  predecessorWorkRunId: null,
  triggerKind: 'manual',
  triggerRef: 'trigger-1',
  idempotencyKey: 'key-1',
  rootTaskId: 'task-1',
  expiresAt: '2026-08-21T01:00:00.000Z',
  boundAt: '2026-08-21T00:00:01.000Z',
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:01.000Z',
};

function setup(latest: WorkRun | null = firstRun) {
  const calls: unknown[] = [];
  const identity = {
    async findWorkById() {
      return work;
    },
    async findLatestWorkRun() {
      return latest;
    },
  };
  const starter = {
    async execute(input: unknown) {
      calls.push(input);
      return {
        workRun: firstRun,
        executionReceipt: { reused: false, taskId: 'task-1' },
      };
    },
  };
  const projection = {
    async getWorkListItem() {
      return {
        product_state: 'needs_you',
        latest_run_summary: {
          id: firstRun.id,
          updated_at: firstRun.updatedAt,
          result_summary: 'Draft is ready for review.',
          result_capture_status: 'present',
        },
      } as any;
    },
  };
  return {
    calls,
    service: new WorkExecutionService(identity, starter, projection),
  };
}

describe('WorkExecutionService', () => {
  it('starts an existing Work through the low-level WorkRun primitive', async () => {
    const { service, calls } = setup();
    const receipt = await service.startWork({
      accessContext,
      workId: work.id,
      triggerKind: 'manual',
      triggerRef: 'from-chat',
    });

    expect(receipt).toMatchObject({
      work: { id: work.id },
      workRun: { id: firstRun.id },
      executionReceipt: { taskId: 'task-1' },
    });
    expect(calls).toEqual([
      expect.objectContaining({ workId: work.id, triggerRef: 'from-chat' }),
    ]);
  });

  it('continues the same Work as a new WorkRun without exposing Task/Run APIs', async () => {
    const { service, calls } = setup(firstRun);
    await service.continueWork({
      accessContext,
      workId: work.id,
      feedback: 'Focus on technical architecture.',
    });

    expect(calls).toEqual([
      expect.objectContaining({
        workId: work.id,
        predecessorWorkRunId: firstRun.id,
        input: { feedback: 'Focus on technical architecture.' },
      }),
    ]);
  });

  it('returns an honest not_started view without manufacturing a technical Run', async () => {
    const { service } = setup(null);
    await expect(
      service.getWorkState({ accessContext, workId: work.id }),
    ).resolves.toMatchObject({
      work: { id: work.id },
      currentWorkRun: null,
      productState: 'not_started',
      resultSummary: null,
      artifacts: [],
    });
  });

  it('projects ordinary product state without leaking Task or Run identities', async () => {
    const { service } = setup(firstRun);
    const state = await service.getWorkState({
      accessContext,
      workId: work.id,
    });

    expect(state).toMatchObject({
      work: { id: work.id },
      currentWorkRun: { id: firstRun.id },
      productState: 'needs_you',
      resultSummary: 'Draft is ready for review.',
      artifacts: [],
    });
    expect('taskId' in (state as any)).toBe(false);
    expect('runId' in (state as any)).toBe(false);
  });
});
