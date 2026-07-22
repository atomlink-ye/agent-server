import { randomUUID } from 'node:crypto';

import { assertTaskTransition, type TaskStatus } from './task-status.js';

export interface Task {
  readonly id: string;
  readonly tenantId: string;
  readonly rootTaskId: string;
  readonly parentTaskId: string | null;
  readonly parentRunId: string | null;
  readonly depth: number;
  readonly status: TaskStatus;
  readonly ingress: 'api';
  readonly invokableKind: 'agent';
  readonly invokableVersionId: string;
  readonly inputSnapshotRef: string;
  readonly inputFingerprint: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type TaskSnapshot = Task;

export interface CreateRootTaskOptions {
  readonly id?: string;
  readonly depth?: number;
  readonly ingress: 'api';
  readonly invokableKind: 'agent';
  readonly invokableVersionId: string;
  readonly inputSnapshotRef: string;
  readonly inputFingerprint: string;
  readonly now?: () => Date;
}

const ROOT_TASK_DEPTH = 0;
const LOCAL_TENANT_ID = 'tenant_local';

export function createRootTask(options: CreateRootTaskOptions): Task {
  const depth = options.depth ?? ROOT_TASK_DEPTH;

  if (depth !== ROOT_TASK_DEPTH) {
    throw new Error('Root task admission requires depth 0 for a root task');
  }

  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  const id = options.id ?? randomUUID();

  return rehydrateTask({
    id,
    tenantId: LOCAL_TENANT_ID,
    rootTaskId: id,
    parentTaskId: null,
    parentRunId: null,
    depth,
    status: 'queued',
    ingress: options.ingress,
    invokableKind: options.invokableKind,
    invokableVersionId: options.invokableVersionId,
    inputSnapshotRef: options.inputSnapshotRef,
    inputFingerprint: options.inputFingerprint,
    createdAt: timestamp,
    updatedAt: timestamp,
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

function assertTaskShape(task: TaskSnapshot): void {
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
