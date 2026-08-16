import { describe, expect, it, vi } from 'vitest';

import type { WorkIdentityApi } from './work-identity-api.js';
import {
  StartWorkRun,
  UnsupportedWorkCompositionCapabilityError,
} from './start-work-run.js';
import type { ResolvedWorkDefinition } from '../../domain/work/work-composition.js';
import type { WorkRun } from '../../domain/work/work-run.js';
import type { AccessContext } from '../../platform/access-context.js';

const access: AccessContext = {
  tenantId: 'tenant-a',
  workspaceId: '11111111-1111-4111-8111-111111111111',
  principalType: 'service_account',
  principalId: 'sa-a',
  policySnapshotVersion: 'v1',
};

const now = '2026-08-16T00:00:00.000Z';
const definitionVersionId = '22222222-2222-4222-8222-222222222222';

function resolved(
  kind: 'single_agent' | 'collaboration',
): ResolvedWorkDefinition {
  const collaboration = kind === 'collaboration';
  return {
    definitionId: '33333333-3333-4333-8333-333333333333',
    definitionVersionId,
    kind,
    name: kind,
    description: null,
    sourceFingerprint: 'sha256:source',
    resolvedFingerprint: 'sha256:resolved',
    participants: [
      {
        logicalName: collaboration ? 'lead' : 'primary',
        role: collaboration ? 'lead' : 'primary',
        agentVersionId: '44444444-4444-4444-8444-444444444444',
        agentFingerprint: 'sha256:agent',
        toolRefs: [],
        skills: [],
      },
    ],
    environment: collaboration
      ? {
          versionId: '55555555-5555-4555-8555-555555555555',
          fingerprint: 'sha256:environment',
        }
      : null,
    memories: [],
    platformCapabilities: collaboration
      ? ['collaboration', 'platform_mcp']
      : [],
    executionPolicy: {
      invokable: {
        kind: collaboration ? 'team' : 'agent',
        versionId: definitionVersionId,
      },
      runtimeSessionPolicy: collaboration ? 'reusable' : 'fresh',
      runtimeWorkspacePolicy: collaboration ? 'work_run_scoped' : 'run_scoped',
      requiredRuntimeCapabilities: collaboration
        ? ['reusable_session', 'external_workspace', 'platform_mcp']
        : [],
    },
  };
}

function pending(): WorkRun {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    tenantId: access.tenantId,
    workspaceId: access.workspaceId,
    workId: '77777777-7777-4777-8777-777777777777',
    definitionVersionId,
    triggerKind: 'manual',
    triggerRef: 'research market',
    idempotencyKey: 'idem',
    rootTaskId: null,
    expiresAt: '2026-08-16T01:00:00.000Z',
    boundAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function fakeIdentity(definition: ResolvedWorkDefinition) {
  const run = pending();
  const recordResolvedManifest = vi.fn(async (input: any) => ({
    workRunId: input.workRunId,
    tenantId: access.tenantId,
    workspaceId: access.workspaceId,
    entries: input.entries,
  }));
  const identity = {
    resolveCurrentDefinition: vi.fn(async () => definition),
    startWorkRun: vi.fn(async () => run),
    getResolvedManifest: vi.fn(async () => null),
    recordResolvedManifest,
    bindRootTaskCas: vi.fn(async ({ rootTaskId }: any) => ({
      ...run,
      rootTaskId,
      boundAt: now,
    })),
  } as unknown as WorkIdentityApi;
  return { identity, recordResolvedManifest };
}

describe('StartWorkRun composition admission', () => {
  it('dispatches a single-Agent Work through the Agent invokable and pins its manifest', async () => {
    const { identity, recordResolvedManifest } = fakeIdentity(
      resolved('single_agent'),
    );
    const admitRoot = vi.fn(async () => ({
      taskId: '88888888-8888-4888-8888-888888888888',
      reused: false,
    }));
    const start = new StartWorkRun({
      identity,
      execution: { admitRoot },
      runtimeCapabilities: { capabilities: () => ({ supported: new Set() }) },
      now: () => new Date(now),
    });

    const result = await start.execute({
      accessContext: access,
      workId: pending().workId,
      triggerKind: 'manual',
      triggerRef: 'research market',
    });

    expect(admitRoot).toHaveBeenCalledWith(
      expect.objectContaining({
        invokable: { kind: 'agent', versionId: definitionVersionId },
      }),
    );
    expect(result.workRun.rootTaskId).toBe(
      '88888888-8888-4888-8888-888888888888',
    );
    expect(recordResolvedManifest).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: expect.arrayContaining([
          expect.objectContaining({ resourceKind: 'definition' }),
          expect.objectContaining({ resourceKind: 'agent' }),
        ]),
      }),
    );
  });

  it('dispatches collaboration through the Team invokable when all required capabilities exist', async () => {
    const { identity, recordResolvedManifest } = fakeIdentity(
      resolved('collaboration'),
    );
    const admitRoot = vi.fn(async () => ({
      taskId: '99999999-9999-4999-8999-999999999999',
      reused: false,
    }));
    const start = new StartWorkRun({
      identity,
      execution: { admitRoot },
      runtimeCapabilities: {
        capabilities: () => ({
          supported: new Set([
            'reusable_session',
            'external_workspace',
            'platform_mcp',
          ] as const),
        }),
      },
      now: () => new Date(now),
    });

    await start.execute({
      accessContext: access,
      workId: pending().workId,
      triggerKind: 'manual',
      triggerRef: 'research market',
    });

    expect(admitRoot).toHaveBeenCalledWith(
      expect.objectContaining({
        invokable: { kind: 'team', versionId: definitionVersionId },
      }),
    );
    expect(recordResolvedManifest).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: expect.arrayContaining([
          expect.objectContaining({
            resourceKind: 'platform_capability',
            requestedRef: 'collaboration',
          }),
          expect.objectContaining({
            resourceKind: 'platform_capability',
            requestedRef: 'platform_mcp',
          }),
        ]),
      }),
    );
  });

  it('fails before technical Task admission when the Execution Plane lacks a required capability', async () => {
    const { identity, recordResolvedManifest } = fakeIdentity(
      resolved('collaboration'),
    );
    const admitRoot = vi.fn();
    const start = new StartWorkRun({
      identity,
      execution: { admitRoot },
      runtimeCapabilities: {
        capabilities: () => ({
          supported: new Set([
            'reusable_session',
            'external_workspace',
          ] as const),
        }),
      },
      now: () => new Date(now),
    });

    await expect(
      start.execute({
        accessContext: access,
        workId: pending().workId,
        triggerKind: 'manual',
        triggerRef: 'research market',
      }),
    ).rejects.toBeInstanceOf(UnsupportedWorkCompositionCapabilityError);
    expect(admitRoot).not.toHaveBeenCalled();
    expect(recordResolvedManifest).not.toHaveBeenCalled();
  });
});
