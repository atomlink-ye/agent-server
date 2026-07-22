export const taskStatuses = [
  'queued',
  'active',
  'completed',
  'failed',
  'cancelled',
] as const;

export type TaskStatus = (typeof taskStatuses)[number];

export const terminalTaskStatuses: ReadonlySet<TaskStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

const transitions: Readonly<Record<TaskStatus, ReadonlySet<TaskStatus>>> = {
  queued: new Set(['active', 'cancelled']),
  active: new Set(['completed', 'failed', 'cancelled']),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
};

export function canTransitionTask(
  current: TaskStatus,
  next: TaskStatus,
): boolean {
  return transitions[current].has(next);
}

export function assertTaskTransition(
  current: TaskStatus,
  next: TaskStatus,
): void {
  if (!canTransitionTask(current, next)) {
    throw new InvalidTaskTransitionError(current, next);
  }
}

export class InvalidTaskTransitionError extends Error {
  public constructor(current: TaskStatus, next: TaskStatus) {
    super(`Task cannot transition from ${current} to ${next}`);
    this.name = 'InvalidTaskTransitionError';
  }
}
