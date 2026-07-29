export const runStatuses = [
  'queued',
  'running',
  'waiting_children',
  'succeeded',
  'failed',
  'timed_out',
  'cancelled',
] as const;

export type RunStatus = (typeof runStatuses)[number];

export const terminalRunStatuses: ReadonlySet<RunStatus> = new Set([
  'succeeded',
  'failed',
  'timed_out',
  'cancelled',
]);

const transitions: Readonly<Record<RunStatus, ReadonlySet<RunStatus>>> = {
  queued: new Set(['running', 'cancelled']),
  running: new Set([
    'waiting_children',
    'succeeded',
    'failed',
    'timed_out',
    'cancelled',
  ]),
  waiting_children: new Set(['succeeded', 'failed', 'cancelled']),
  succeeded: new Set(),
  failed: new Set(),
  timed_out: new Set(),
  cancelled: new Set(),
};

export function canTransitionRun(current: RunStatus, next: RunStatus): boolean {
  return transitions[current].has(next);
}

export function assertRunTransition(current: RunStatus, next: RunStatus): void {
  if (!canTransitionRun(current, next)) {
    throw new InvalidRunTransitionError(current, next);
  }
}

export class InvalidRunTransitionError extends Error {
  public constructor(current: RunStatus, next: RunStatus) {
    super(`Run cannot transition from ${current} to ${next}`);
    this.name = 'InvalidRunTransitionError';
  }
}
