import { randomUUID } from 'node:crypto';

import { assertTaskTransition, type TaskStatus } from './task-status.js';

export type TaskOrigin =
  | { readonly ingress: 'api'; readonly originRef: null }
  | { readonly ingress: 'lark'; readonly originRef: string };

interface TaskFields {
  readonly id: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
  readonly policySnapshotVersion: string;
  readonly rootTaskId: string;
  readonly parentTaskId: string | null;
  readonly parentRunId: string | null;
  readonly depth: number;
  readonly logicalStepKey: string | null;
  readonly nodePath: string | null;
  readonly status: TaskStatus;
  readonly invokableKind: 'agent' | 'team';
  readonly invokableVersionId: string;
  readonly inputSnapshotRef: string;
  readonly inputFingerprint: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly sessionId?: string | null;
  readonly sourceMessageId?: string | null;
  readonly sourceTeamMessageId?: string | null;
  readonly inputTeamMessageIds?: readonly string[];
  readonly generation?: number | null;
  readonly laneSequence?: number | null;
  readonly failureDetail?: string | null;
  readonly memorySnapshotId?: string | null;
  readonly memorySnapshotHash?: string | null;
  readonly teamMemberRunId?: string | null;
  readonly teamSequence?: number | null;
  readonly teamTaskKind?: 'lead_turn' | 'work_attempt' | null;
}

export type Task = TaskFields & TaskOrigin;

export type TaskSnapshot = TaskFields & {
  readonly ingress: unknown;
  readonly originRef: unknown;
};

interface CreateRootTaskFields {
  readonly id?: string;
  readonly depth?: number;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
  readonly policySnapshotVersion: string;
  readonly invokableKind: 'agent' | 'team';
  readonly invokableVersionId: string;
  readonly inputSnapshotRef: string;
  readonly inputFingerprint: string;
  readonly now?: () => Date;
  readonly teamMemberRunId?: string | null;
  readonly teamSequence?: number | null;
  readonly teamTaskKind?: 'lead_turn' | 'work_attempt' | null;
  readonly sourceMessageId?: string | null;
  readonly sourceTeamMessageId?: string | null;
  readonly inputTeamMessageIds?: readonly string[];
}

export type CreateRootTaskOptions = CreateRootTaskFields & TaskOrigin;

export interface CreateChildTaskOptions {
  readonly id?: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
  readonly policySnapshotVersion: string;
  readonly rootTaskId: string;
  readonly parentTaskId: string;
  readonly parentRunId: string;
  readonly invokableKind: 'agent' | 'team';
  readonly invokableVersionId: string;
  readonly inputSnapshotRef: string;
  readonly inputFingerprint: string;
  readonly logicalStepKey: string;
  readonly nodePath: string;
  readonly now?: () => Date;
  readonly teamMemberRunId?: string | null;
  readonly teamSequence?: number | null;
  readonly teamTaskKind?: 'lead_turn' | 'work_attempt' | null;
  readonly sourceTeamMessageId?: string | null;
  readonly inputTeamMessageIds?: readonly string[];
}

const ROOT_TASK_DEPTH = 0;
const CHILD_TASK_DEPTH = 1;

export function createRootTask(options: CreateRootTaskOptions): Task {
  const depth = options.depth ?? ROOT_TASK_DEPTH;

  if (depth !== ROOT_TASK_DEPTH) {
    throw new Error('Root task admission requires depth 0 for a root task');
  }

  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  const id = options.id ?? randomUUID();

  return rehydrateTask({
    id,
    tenantId: options.tenantId,
    workspaceId: options.workspaceId,
    principalType: options.principalType,
    principalId: options.principalId,
    policySnapshotVersion: options.policySnapshotVersion,
    rootTaskId: id,
    parentTaskId: null,
    parentRunId: null,
    depth,
    logicalStepKey: null,
    nodePath: null,
    status: 'queued',
    ingress: options.ingress,
    originRef: options.originRef,
    invokableKind: options.invokableKind,
    invokableVersionId: options.invokableVersionId,
    inputSnapshotRef: options.inputSnapshotRef,
    inputFingerprint: options.inputFingerprint,
    createdAt: timestamp,
    updatedAt: timestamp,
    teamMemberRunId: options.teamMemberRunId ?? null,
    teamSequence: options.teamSequence ?? null,
    teamTaskKind: options.teamTaskKind ?? null,
    sourceMessageId: options.sourceMessageId ?? null,
    sourceTeamMessageId: options.sourceTeamMessageId ?? null,
    inputTeamMessageIds: options.inputTeamMessageIds ?? [],
  });
}

export function createChildTask(options: CreateChildTaskOptions): Task {
  const timestamp = (options.now ?? (() => new Date()))().toISOString();

  return rehydrateTask({
    id: options.id ?? randomUUID(),
    tenantId: options.tenantId,
    workspaceId: options.workspaceId,
    principalType: options.principalType,
    principalId: options.principalId,
    policySnapshotVersion: options.policySnapshotVersion,
    rootTaskId: options.rootTaskId,
    parentTaskId: options.parentTaskId,
    parentRunId: options.parentRunId,
    depth: CHILD_TASK_DEPTH,
    logicalStepKey: options.logicalStepKey,
    nodePath: options.nodePath,
    status: 'queued',
    ingress: 'api',
    originRef: null,
    invokableKind: options.invokableKind,
    invokableVersionId: options.invokableVersionId,
    inputSnapshotRef: options.inputSnapshotRef,
    inputFingerprint: options.inputFingerprint,
    createdAt: timestamp,
    updatedAt: timestamp,
    teamMemberRunId: options.teamMemberRunId ?? null,
    teamSequence: options.teamSequence ?? null,
    teamTaskKind: options.teamTaskKind ?? null,
    sourceTeamMessageId: options.sourceTeamMessageId ?? null,
    inputTeamMessageIds: options.inputTeamMessageIds ?? [],
  });
}

export function rehydrateTask(snapshot: TaskSnapshot): Task {
  assertTaskShape(snapshot);
  assertTaskTimestamps(snapshot);

  return Object.freeze({ ...snapshot });
}

export function transitionTask(
  task: Task,
  status: TaskStatus,
  now: () => Date = () => new Date(),
): Task {
  assertTaskTransition(task.status, status);

  return rehydrateTask({
    ...task,
    status,
    updatedAt: now().toISOString(),
  });
}

function assertTaskShape(task: TaskSnapshot): asserts task is Task {
  assertAuthoritativeScope(task);

  if (task.ingress !== 'api' && task.ingress !== 'lark') {
    throw new Error('Task snapshots require a supported ingress');
  }
  if (task.ingress === 'api' && task.originRef !== null) {
    throw new Error('API task snapshots require originRef to be null');
  }
  if (
    task.ingress === 'lark' &&
    (typeof task.originRef !== 'string' || task.originRef.trim().length === 0)
  ) {
    throw new Error('Lark task snapshots require a non-empty originRef');
  }

  if (task.depth < ROOT_TASK_DEPTH) {
    throw new Error('Task depth must be zero or greater');
  }

  if (task.depth === ROOT_TASK_DEPTH) {
    if (task.rootTaskId !== task.id) {
      throw new Error('Root task snapshots require rootTaskId equal to id');
    }

    if (task.parentTaskId !== null || task.parentRunId !== null) {
      throw new Error(
        'Root task snapshots cannot reference a parent task or run',
      );
    }

    if (task.logicalStepKey !== null || task.nodePath !== null) {
      throw new Error(
        'Root task snapshots cannot include step identity fields',
      );
    }

    return;
  }

  if (task.parentTaskId === null || task.parentRunId === null) {
    throw new Error(
      'Child task snapshots require both parentTaskId and parentRunId',
    );
  }

  if (task.rootTaskId === task.id) {
    throw new Error(
      'Child task snapshots cannot self-reference as the root task',
    );
  }

  assertNonEmptyTaskString(
    'logicalStepKey',
    task.logicalStepKey,
    'Child task snapshots',
  );
  assertNonEmptyTaskString('nodePath', task.nodePath, 'Child task snapshots');
}

function assertAuthoritativeScope(task: TaskSnapshot): void {
  const requiredScopeFields = [
    ['tenantId', task.tenantId],
    ['workspaceId', task.workspaceId],
    ['principalType', task.principalType],
    ['principalId', task.principalId],
    ['policySnapshotVersion', task.policySnapshotVersion],
  ] as const;

  for (const [fieldName, value] of requiredScopeFields) {
    if (value.trim().length === 0) {
      throw new Error(
        `Task authoritative scope field ${fieldName} must be a non-empty string`,
      );
    }
  }
}

function assertTaskTimestamps(task: TaskSnapshot): void {
  const createdAt = Date.parse(task.createdAt);
  const updatedAt = Date.parse(task.updatedAt);

  if (Number.isNaN(createdAt) || Number.isNaN(updatedAt)) {
    throw new Error('Task timestamps must be valid ISO-8601 instants');
  }

  if (updatedAt < createdAt) {
    throw new Error(
      'Task updatedAt must be greater than or equal to createdAt',
    );
  }
}

function assertNonEmptyTaskString(
  fieldName: string,
  value: string | null,
  subject: string,
): void {
  if (value === null || value.trim().length === 0) {
    throw new Error(`${subject} require ${fieldName} to be a non-empty string`);
  }
}
