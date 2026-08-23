import type { TraceAttempt, TraceWorkItem } from './normalized';

export type TraceEntry = {
  readonly workItem: TraceWorkItem;
  readonly attempt: TraceAttempt;
};

export type Geometry = {
  readonly left: number;
  readonly width: number;
};

export type CapturedRange = {
  readonly startedAt: string;
  readonly endedAt: string;
};

export function timelineGeometry(
  attempts: readonly TraceEntry[],
): ReadonlyMap<string, Geometry> {
  const captured = attempts.filter(
    ({ attempt }) =>
      attempt.timingCaptured &&
      attempt.startedAt !== null &&
      attempt.endedAt !== null &&
      attempt.durationMs !== null,
  );
  if (!captured.length) return new Map();
  const start = Math.min(
    ...captured.map(({ attempt }) => Date.parse(attempt.startedAt!)),
  );
  const end = Math.max(
    ...captured.map(({ attempt }) => Date.parse(attempt.endedAt!)),
  );
  const range = end - start;
  return new Map(
    captured.map(({ attempt }) => [
      attempt.id,
      {
        left: range
          ? ((Date.parse(attempt.startedAt!) - start) / range) * 100
          : 0,
        width: range ? (attempt.durationMs! / range) * 100 : 100,
      },
    ]),
  );
}

export function capturedTimelineRange(
  attempts: readonly TraceEntry[],
): CapturedRange | null {
  const captured = attempts.filter(
    ({ attempt }) =>
      attempt.timingCaptured &&
      attempt.startedAt !== null &&
      attempt.endedAt !== null,
  );
  if (!captured.length) return null;
  return {
    startedAt: captured.map(({ attempt }) => attempt.startedAt!).sort()[0]!,
    endedAt: captured
      .map(({ attempt }) => attempt.endedAt!)
      .sort()
      .at(-1)!,
  };
}

export function relativeTicks(startedAt: string, endedAt: string) {
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  const span = Math.max(0, end - start);
  const count = span > 20 * 60_000 ? 7 : span > 5 * 60_000 ? 6 : 5;
  return Array.from({ length: count }, (_, index) => {
    const position = (index / (count - 1)) * 100;
    const timestamp = new Date(start + (span * index) / (count - 1));
    return {
      position,
      label:
        index === 0 || index === count - 1
          ? formatClock(timestamp)
          : `+${formatRelative((span * index) / (count - 1))}`,
    };
  });
}

export function durationLabel(attempt: TraceAttempt): string {
  return attempt.durationMs === null
    ? 'Not captured'
    : `${(attempt.durationMs / 1000).toFixed(1)} seconds`;
}

export function formatActiveDuration(items: readonly TraceWorkItem[]): string {
  const milliseconds = items.reduce(
    (total, item) =>
      total +
      item.attempts.reduce(
        (sum, attempt) => sum + (attempt.durationMs ?? 0),
        0,
      ),
    0,
  );
  if (!milliseconds) return 'active time not captured';
  const minutes = Math.round(milliseconds / 60_000);
  return minutes
    ? `${minutes}m active`
    : `${Math.round(milliseconds / 1000)}s active`;
}

function formatClock(value: Date): string {
  return value.toISOString().slice(11, 16);
}

function formatRelative(milliseconds: number): string {
  const minutes = Math.round(milliseconds / 60_000);
  return minutes ? `${minutes}m` : `${Math.round(milliseconds / 1000)}s`;
}
