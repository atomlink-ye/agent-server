/**
 * A TimelineSpan is a run's plotted activity window. Runs are what the
 * server actually captures execution timing against; a Team Work Item
 * Attempt is a label some (not all) runs carry. Plotting spans -- rather
 * than attempts -- is what lets a single-agent Work (no attempts at all)
 * show its activity, and lets a retried task render every run instead of
 * being silently hidden behind one `not_captured` attempt.
 */
export type TimelineSpan = {
  readonly key: string; // the run's own id
  readonly laneKey: string; // actorId ?? taskId ?? key
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly durationMs: number | null;
  readonly timingCaptured: boolean;
  readonly status: string;
  readonly attemptId: string | null; // present for team shapes, null otherwise
  readonly workItemId: string | null;
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
  spans: readonly TimelineSpan[],
): ReadonlyMap<string, Geometry> {
  const captured = spans.filter(
    (span) =>
      span.timingCaptured &&
      span.startedAt !== null &&
      span.endedAt !== null &&
      span.durationMs !== null,
  );
  if (!captured.length) return new Map();
  const start = Math.min(
    ...captured.map((span) => Date.parse(span.startedAt!)),
  );
  const end = Math.max(...captured.map((span) => Date.parse(span.endedAt!)));
  const range = end - start;
  return new Map(
    captured.map((span) => [
      span.key,
      {
        left: range ? ((Date.parse(span.startedAt!) - start) / range) * 100 : 0,
        width: range ? (span.durationMs! / range) * 100 : 100,
      },
    ]),
  );
}

export function capturedTimelineRange(
  spans: readonly TimelineSpan[],
): CapturedRange | null {
  const captured = spans.filter(
    (span) =>
      span.timingCaptured && span.startedAt !== null && span.endedAt !== null,
  );
  if (!captured.length) return null;
  return {
    startedAt: captured.map((span) => span.startedAt!).sort()[0]!,
    endedAt: captured
      .map((span) => span.endedAt!)
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

export function durationLabel(span: TimelineSpan): string {
  return span.durationMs === null
    ? 'Not captured'
    : `${(span.durationMs / 1000).toFixed(1)} seconds`;
}

export function formatActiveDuration(spans: readonly TimelineSpan[]): string {
  const milliseconds = spans.reduce(
    (total, span) => total + (span.durationMs ?? 0),
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
