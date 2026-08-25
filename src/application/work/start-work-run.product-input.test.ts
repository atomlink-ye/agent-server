import { describe, expect, it, vi } from 'vitest';

import type { WorkIdentityApi } from './work-identity-api.js';
import { StartWorkRun, WorkRunInputValidationError } from './start-work-run.js';

const access = {
  tenantId: 'tenant-1',
  workspaceId: '11111111-1111-4111-8111-111111111111',
  principalType: 'service_account',
  principalId: 'svc-1',
  policySnapshotVersion: 'policy-1',
} as const;
const workId = '22222222-2222-4222-8222-222222222222';
const definitionId = '33333333-3333-4333-8333-333333333333';
const definitionVersionId = '44444444-4444-4444-8444-444444444444';
const workerVersionId = '55555555-5555-4555-8555-555555555555';
const workRunId = '66666666-6666-4666-8666-666666666666';
const taskId = '77777777-7777-4777-8777-777777777777';
const now = '2026-08-16T00:00:00.000Z';

const resolved = {
  definitionId,
  definitionVersionId,
  kind: 'single_worker' as const,
  name: 'earnings-research',
  description: 'Research one company earnings release.',
  sourceFingerprint: `sha256:${'a'.repeat(64)}`,
  resolvedFingerprint: `sha256:${'b'.repeat(64)}`,
  participants: [
    {
      logicalName: 'earnings-research',
      role: 'primary' as const,
      workerVersionId,
      workerFingerprint: `sha256:${'c'.repeat(64)}`,
      toolRefs: [],
      skills: [],
    },
  ],
  environment: null,
  memories: [],
  platformCapabilities: [],
  executionPolicy: {
    invokable: { kind: 'worker' as const, versionId: workerVersionId },
    runtimeSessionPolicy: 'fresh' as const,
    runtimeWorkspacePolicy: 'run_scoped' as const,
    requiredRuntimeCapabilities: [],
  },
};

const pending = {
  id: workRunId,
  tenantId: access.tenantId,
  workspaceId: access.workspaceId,
  workId,
  definitionVersionId,
  triggerKind: 'manual' as const,
  triggerRef: 'manual-run',
  idempotencyKey: 'work-run-key',
  expiresAt: '2026-08-17T00:00:00.000Z',
  rootTaskId: null,
  boundAt: null,
  createdAt: now,
  updatedAt: now,
};

function harness() {
  const startWorkRun = vi.fn().mockResolvedValue(pending);
  const recordResolvedManifest = vi.fn().mockResolvedValue({ entries: [] });
  const identity = {
    resolveCurrentDefinition: vi.fn().mockResolvedValue(resolved),
    startWorkRun,
    getResolvedManifest: vi.fn().mockResolvedValue(null),
    recordResolvedManifest,
    bindRootTaskCas: vi.fn().mockResolvedValue({
      ...pending,
      rootTaskId: taskId,
      boundAt: now,
    }),
  } as unknown as WorkIdentityApi;
  const recordInput = vi.fn().mockResolvedValue({
    workRunId,
    input: { symbol: 'AAPL' },
    fingerprint: `sha256:${'d'.repeat(64)}`,
  });
  const admitRoot = vi.fn().mockResolvedValue({ taskId, reused: false });
  const start = new StartWorkRun({
    identity,
    execution: { admitRoot },
    runtimeCapabilities: { supported: new Set() },
    productDefinitions: {
      getInputContract: vi.fn().mockResolvedValue({
        name: 'earnings-research',
        description: 'Research one company earnings release.',
        schema: {
          type: 'object',
          properties: {
            symbol: { type: 'string', min_length: 1, max_length: 12 },
          },
          required: ['symbol'],
          additional_properties: false,
        },
      }),
    },
    workRunInputs: {
      record: recordInput,
      find: vi.fn(),
    },
    now: () => new Date(now),
  });
  return {
    start,
    startWorkRun,
    recordInput,
    recordResolvedManifest,
    admitRoot,
  };
}

describe('StartWorkRun Product input contract', () => {
  it('rejects invalid input before WorkRun creation or provider admission', async () => {
    const { start, startWorkRun, recordInput, admitRoot } = harness();
    await expect(
      start.execute({
        accessContext: access,
        workId,
        triggerKind: 'manual',
        input: {},
      }),
    ).rejects.toBeInstanceOf(WorkRunInputValidationError);
    expect(startWorkRun).not.toHaveBeenCalled();
    expect(recordInput).not.toHaveBeenCalled();
    expect(admitRoot).not.toHaveBeenCalled();
  });

  it('persists the exact input before Task admission and renders it to the participant', async () => {
    const { start, recordInput, recordResolvedManifest, admitRoot } = harness();
    await start.execute({
      accessContext: access,
      workId,
      triggerKind: 'manual',
      triggerRef: 'manual-run',
      input: { symbol: 'AAPL' },
    });

    expect(recordInput).toHaveBeenCalledWith(
      expect.objectContaining({
        workRunId,
        snapshot: { symbol: 'AAPL' },
      }),
    );
    expect(admitRoot).toHaveBeenCalledWith(
      expect.objectContaining({
        invokable: { kind: 'worker', versionId: workerVersionId },
        input: {
          text: expect.stringContaining('"symbol":"AAPL"'),
        },
      }),
    );
    expect(recordInput.mock.invocationCallOrder[0]).toBeLessThan(
      admitRoot.mock.invocationCallOrder[0]!,
    );
    expect(recordResolvedManifest.mock.invocationCallOrder[0]).toBeLessThan(
      admitRoot.mock.invocationCallOrder[0]!,
    );
  });
});
