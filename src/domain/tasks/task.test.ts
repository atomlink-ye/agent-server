import { describe, expect, it } from 'vitest';

import { createRootTask, rehydrateTask, transitionTask } from './task.js';

const authoritativeScope = {
  tenantId: 'tenant_alpha',
  workspaceId: 'workspace_main',
  principalType: 'service_account' as const,
  principalId: 'svc_alpha',
  policySnapshotVersion: 'policy-2026-07-22',
};

describe('task', () => {
  it('creates a queued root task with authoritative owner scope', () => {
    const now = new Date('2026-07-22T12:00:00.000Z');

    const task = createRootTask({
      id: 'bf3d2bc7-2db0-4c80-9790-42e388bf0b63',
      ...authoritativeScope,
      ingress: 'api',
      invokableKind: 'agent',
      invokableVersionId: 'baseline-run-api',
      inputSnapshotRef: 'inline:prompt',
      inputFingerprint: 'sha256:abc',
      now: () => now,
    });

    expect(task.status).toBe('queued');
    expect(task.rootTaskId).toBe(task.id);
    expect(task.parentTaskId).toBeNull();
    expect(task.parentRunId).toBeNull();
    expect(task.depth).toBe(0);
    expect(task.tenantId).toBe(authoritativeScope.tenantId);
    expect(task.workspaceId).toBe(authoritativeScope.workspaceId);
    expect(task.principalType).toBe(authoritativeScope.principalType);
    expect(task.principalId).toBe(authoritativeScope.principalId);
    expect(task.policySnapshotVersion).toBe(
      authoritativeScope.policySnapshotVersion,
    );
    expect(task.createdAt).toBe(now.toISOString());
    expect(task.updatedAt).toBe(now.toISOString());
  });

  it('rejects a root task when authoritative scope values are blank', () => {
    expect(() =>
      createRootTask({
        ...authoritativeScope,
        principalId: '   ',
        ingress: 'api',
        invokableKind: 'agent',
        invokableVersionId: 'baseline-run-api',
        inputSnapshotRef: 'inline:prompt',
        inputFingerprint: 'sha256:scope',
      }),
    ).toThrow(/scope/i);
  });

  it('rejects depth greater than 0 for a root task', () => {
    expect(() =>
      createRootTask({
        ...authoritativeScope,
        ingress: 'api',
        invokableKind: 'agent',
        invokableVersionId: 'baseline-run-api',
        inputSnapshotRef: 'inline:prompt',
        inputFingerprint: 'sha256:def',
        depth: 1,
      }),
    ).toThrow(/root task/i);
  });

  it('rehydrates a persisted root task snapshot', () => {
    const task = rehydrateTask({
      id: 'bf3d2bc7-2db0-4c80-9790-42e388bf0b63',
      ...authoritativeScope,
      rootTaskId: 'bf3d2bc7-2db0-4c80-9790-42e388bf0b63',
      parentTaskId: null,
      parentRunId: null,
      depth: 0,
      status: 'queued',
      ingress: 'api',
      invokableKind: 'agent',
      invokableVersionId: 'baseline-run-api',
      inputSnapshotRef: 'inline:prompt',
      inputFingerprint: 'sha256:abc',
      createdAt: '2026-07-22T12:00:00.000Z',
      updatedAt: '2026-07-22T12:00:00.000Z',
    });

    expect(task.id).toBe(task.rootTaskId);
    expect(task.parentTaskId).toBeNull();
    expect(task.parentRunId).toBeNull();
    expect(Object.isFrozen(task)).toBe(true);
  });

  it('transitions a task and refreshes updatedAt', () => {
    const task = createRootTask({
      id: 'bf3d2bc7-2db0-4c80-9790-42e388bf0b63',
      ...authoritativeScope,
      ingress: 'api',
      invokableKind: 'agent',
      invokableVersionId: 'baseline-run-api',
      inputSnapshotRef: 'inline:prompt',
      inputFingerprint: 'sha256:abc',
      now: () => new Date('2026-07-22T12:00:00.000Z'),
    });

    const activeTask = transitionTask(
      task,
      'active',
      () => new Date('2026-07-22T12:05:00.000Z'),
    );
    const completedTask = transitionTask(
      activeTask,
      'completed',
      () => new Date('2026-07-22T12:10:00.000Z'),
    );

    expect(activeTask.status).toBe('active');
    expect(activeTask.updatedAt).toBe('2026-07-22T12:05:00.000Z');
    expect(completedTask.status).toBe('completed');
    expect(completedTask.updatedAt).toBe('2026-07-22T12:10:00.000Z');
  });

  it('rejects inconsistent root-task snapshots during rehydration', () => {
    expect(() =>
      rehydrateTask({
        id: 'bf3d2bc7-2db0-4c80-9790-42e388bf0b63',
        ...authoritativeScope,
        rootTaskId: '8692ed31-fc15-4bd8-ab00-bce97ae4024d',
        parentTaskId: null,
        parentRunId: null,
        depth: 0,
        status: 'queued',
        ingress: 'api',
        invokableKind: 'agent',
        invokableVersionId: 'baseline-run-api',
        inputSnapshotRef: 'inline:prompt',
        inputFingerprint: 'sha256:abc',
        createdAt: '2026-07-22T12:00:00.000Z',
        updatedAt: '2026-07-22T12:00:00.000Z',
      }),
    ).toThrow(/root task/i);
  });
});
