import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';

import parallelRecording from '@/lib/__fixtures__/product-recordings/parallel-success-fa77ba9.json';
import reworkRecording from '@/lib/__fixtures__/product-recordings/rework-once-fa77ba9.json';
import { RunTrace, attemptsFrom, timelineGeometry } from './run-trace';
import { parseRecordedTrace } from './recording-test-helpers';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

function mountTrace(trace: ReturnType<typeof parseRecordedTrace>) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  return { host, root, trace };
}

function expectedWidth(
  attempt: {
    started_at: string | null;
    ended_at: string | null;
    duration_ms: number | null;
  },
  attempts: readonly ReturnType<typeof attemptsFrom>[number][],
) {
  const captured = attempts.filter(
    ({ attempt: candidate }) =>
      candidate.started_at &&
      candidate.ended_at &&
      candidate.duration_ms !== null,
  );
  const start = Math.min(
    ...captured.map(({ attempt: candidate }) =>
      Date.parse(candidate.started_at!),
    ),
  );
  const end = Math.max(
    ...captured.map(({ attempt: candidate }) => Date.parse(candidate.ended_at!)),
  );
  return ((attempt.duration_ms! / (end - start)) * 100);
}

it('E3 renders recorder-backed proportional normal and rework geometry', async () => {
  const traces = [
    parseRecordedTrace(parallelRecording),
    parseRecordedTrace(reworkRecording),
  ];

  for (const trace of traces) {
    const entries = attemptsFrom(trace);
    const geometry = timelineGeometry(entries);
    if (trace === traces[0])
      expect(entries.map(({ attempt }) => attempt.duration_ms).sort((a, b) => (a ?? 0) - (b ?? 0)))
        .toEqual([308425, 312707]);
    else
      expect(
        entries
          .filter(({ workItem }) => workItem.attempts.length === 2)
          .map(({ attempt }) => attempt.duration_ms),
      ).toEqual([177206, 19179]);
    const captured = entries.filter(
      ({ attempt }) => attempt.timing_capture_status === 'captured',
    );
    expect(captured.length).toBeGreaterThan(0);
    for (const { attempt } of captured) {
      expect(geometry.get(attempt.id)?.width).toBeCloseTo(
        expectedWidth(attempt, entries),
        8,
      );
    }

    const { host, root } = mountTrace(trace);
    try {
      await act(async () => {
        root.render(<RunTrace trace={trace} />);
      });

      const attemptButtons = [
        ...host.querySelectorAll<HTMLButtonElement>(
          '[data-testid="trace-attempt"]',
        ),
      ];
      expect(attemptButtons.length).toBe(entries.length);
      expect(
        attemptButtons.every(
          (button) =>
            button.type === 'button' && button.tabIndex === 0 &&
            button.getAttribute('aria-pressed') !== null,
        ),
      ).toBe(true);
      expect(host.textContent).toContain('Inspector');

      const selectedButton = attemptButtons.find(
        (button) => button.getAttribute('aria-pressed') === 'true',
      );
      expect(selectedButton).toBe(attemptButtons[0]);
      const nextButton = attemptButtons.at(-1);
      expect(nextButton).toBeDefined();
      if (!nextButton) continue;
      await act(async () => {
        nextButton.focus();
        nextButton.click();
      });
      expect(nextButton.getAttribute('aria-pressed')).toBe('true');
      expect(host.querySelector('#trace-inspector-heading')).not.toBeNull();

      if (trace === traces[1]) {
        const reworkItem = trace.work_items.find(
          (workItem) => workItem.attempts.length === 2,
        );
        expect(reworkItem).toBeDefined();
        if (!reworkItem) continue;
        expect(reworkItem.attempts.map((attempt) => attempt.id)).toHaveLength(2);
        expect(reworkItem.attempts[0]?.id).not.toBe(
          reworkItem.attempts[1]?.id,
        );
        const feedbackEdges = trace.edges.filter(
          (edge) => edge.kind === 'feedback',
        );
        expect(feedbackEdges).toHaveLength(1);
        expect(feedbackEdges[0]?.attempt_id).toBe(reworkItem.attempts[1]?.id);
        expect(
          attemptButtons.filter((button) =>
            button.getAttribute('aria-label')?.startsWith(reworkItem.subject),
          ),
        ).toHaveLength(2);
        expect(
          host.querySelectorAll('[aria-label="Recorded feedback relation"]'),
        ).toHaveLength(1);
        expect(host.textContent).not.toContain('2/2');
        expect(host.textContent?.toLowerCase()).not.toMatch(
          /rejected|rejection|refused/u,
        );
      }
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  }
});
