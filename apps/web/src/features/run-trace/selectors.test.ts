import { describe, expect, it, vi } from 'vitest';

import { selectTimelineSpans } from './selectors';
import type {
  NormalizedTrace,
  TraceAttempt,
  TraceExecutionEvent,
  TraceExecutionRun,
} from './normalized';

function baseTrace(overrides: Partial<NormalizedTrace> = {}): NormalizedTrace {
  return {
    runId: 'work-run-1',
    work: { id: 'work-1', title: 'Test Work' },
    workRun: { id: 'work-run-1', productState: 'succeeded' },
    actors: new Map(),
    workItems: new Map(),
    attempts: new Map(),
    messages: new Map(),
    activities: [],
    edges: [],
    runs: [],
    events: [],
    timeline: { startedAt: null, endedAt: null },
    coverage: {
      scope: 'mcp_dispatch_and_confirmation',
      completeness: 'mcp_only',
      excludedExecution: [],
    },
    ...overrides,
  };
}

function run(overrides: Partial<TraceExecutionRun>): TraceExecutionRun {
  return {
    id: 'run-a',
    status: 'succeeded',
    actorId: null,
    workItemId: null,
    taskId: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:01:00.000Z',
    ...overrides,
  };
}

function attempt(overrides: Partial<TraceAttempt>): TraceAttempt {
  return {
    id: 'attempt-a',
    attemptNo: 1,
    status: 'succeeded',
    startedAt: null,
    endedAt: null,
    durationMs: null,
    timingCaptured: false,
    feedbackSummary: null,
    feedbackCaptureStatus: 'not_present',
    resultSummary: null,
    resultCaptureStatus: 'not_present',
    workItemId: 'work-item-a',
    taskId: null,
    ...overrides,
  };
}

describe('selectTimelineSpans', () => {
  it('an attempt-free trace yields positioned spans', () => {
    // A single-agent Work has no Team Work Item Attempts at all -- spans
    // come from Runs, not from the (empty) attempt join, so this Work
    // still gets a plotted span instead of showing nothing.
    const trace = baseTrace({
      runs: [
        run({
          id: 'run-a',
          startedAt: '2026-01-01T00:00:00.000Z',
          endedAt: '2026-01-01T00:05:00.000Z',
        }),
      ],
    });

    const spans = selectTimelineSpans(trace);

    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({
      key: 'run-a',
      attemptId: null,
      timingCaptured: true,
      durationMs: 300_000,
    });
  });

  it('a team trace preserves attemptId on every span whose taskId matches', () => {
    const joined = attempt({
      id: 'attempt-a',
      taskId: 'task-a',
      workItemId: 'work-item-a',
    });
    const trace = baseTrace({
      attempts: new Map([[joined.id, joined]]),
      runs: [
        // Joins via taskId, the same column the server joins
        // runs.task_id against team_work_item_attempts.execution_task_id.
        run({ id: 'run-joined', taskId: 'task-a', workItemId: 'work-item-a' }),
        // A lead's own coordination Run: no matching Attempt taskId.
        run({ id: 'run-unjoined', taskId: 'task-other', workItemId: null }),
      ],
    });

    const spans = selectTimelineSpans(trace);

    const joinedSpan = spans.find((span) => span.key === 'run-joined');
    const unjoinedSpan = spans.find((span) => span.key === 'run-unjoined');
    expect(joinedSpan?.attemptId).toBe('attempt-a');
    expect(unjoinedSpan?.attemptId).toBeNull();
  });

  it('a still-running run with no ended_at falls back to the last captured event, never to Date.now()', () => {
    // Date.now() is pinned far past every fixture timestamp: if the
    // selector ever fell back to wall-clock time, durationMs would reflect
    // that instead of the fixture's last captured event, and the test
    // would fail.
    vi.spyOn(Date, 'now').mockReturnValue(
      Date.parse('2099-01-01T00:00:00.000Z'),
    );
    try {
      const events: readonly TraceExecutionEvent[] = [
        {
          sequence: 1,
          type: 'started',
          createdAt: '2026-01-01T00:00:05.000Z',
          runId: 'run-a',
        },
        {
          sequence: 2,
          type: 'progress',
          createdAt: '2026-01-01T00:00:30.000Z',
          runId: 'run-a',
        },
      ];
      const trace = baseTrace({
        runs: [
          run({
            id: 'run-a',
            status: 'running',
            startedAt: '2026-01-01T00:00:00.000Z',
            endedAt: null,
          }),
        ],
        events,
      });

      const spans = selectTimelineSpans(trace);

      expect(spans).toHaveLength(1);
      expect(spans[0]?.endedAt).toBe('2026-01-01T00:00:30.000Z');
      expect(spans[0]?.durationMs).toBe(30_000);
      expect(spans[0]?.timingCaptured).toBe(true);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('a still-running run with no captured event at all stays uncaptured rather than fabricating an end', () => {
    vi.spyOn(Date, 'now').mockReturnValue(
      Date.parse('2099-01-01T00:00:00.000Z'),
    );
    try {
      const trace = baseTrace({
        runs: [
          run({
            id: 'run-a',
            status: 'running',
            startedAt: '2026-01-01T00:00:00.000Z',
            endedAt: null,
          }),
        ],
        events: [],
      });

      const spans = selectTimelineSpans(trace);

      expect(spans[0]?.endedAt).toBeNull();
      expect(spans[0]?.durationMs).toBeNull();
      expect(spans[0]?.timingCaptured).toBe(false);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
