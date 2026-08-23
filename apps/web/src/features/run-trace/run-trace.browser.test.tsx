import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';

import parallelRecording from '@/lib/__fixtures__/product-recordings/parallel-success.json';
import reworkRecording from '@/lib/__fixtures__/product-recordings/rework-once.json';
import { RunTrace } from './run-trace-view';
import { attemptsFrom } from './selectors';
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

type RecordedAttempt = ReturnType<typeof attemptsFrom>[number];

function recordedAttempts(
  trace: ReturnType<typeof parseRecordedTrace>,
): readonly RecordedAttempt[] {
  return [...trace.workItems.values()].flatMap((workItem) =>
    workItem.attempts.map((attempt) => ({ workItem, attempt })),
  );
}

function expectedGeometryFromRecording(attempts: readonly RecordedAttempt[]) {
  const captured = attempts.filter(
    ({ attempt }) =>
      attempt.startedAt && attempt.endedAt && attempt.durationMs !== null,
  );
  const start = Math.min(
    ...captured.map(({ attempt: candidate }) =>
      Date.parse(candidate.startedAt!),
    ),
  );
  const end = Math.max(
    ...captured.map(({ attempt: candidate }) => Date.parse(candidate.endedAt!)),
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

function stylePercent(button: HTMLButtonElement, property: string): number {
  const value = button.style.getPropertyValue(property);
  expect(value, `${property} must be present on rendered span`).toMatch(
    /^-?\d+(?:\.\d+)?%$/u,
  );
  return Number.parseFloat(value);
}

it('renders recorder-backed proportional normal and rework geometry', async () => {
  const traces = [
    parseRecordedTrace(parallelRecording),
    parseRecordedTrace(reworkRecording),
  ];

  for (const trace of traces) {
    const entries = recordedAttempts(trace);
    const expectedGeometry = expectedGeometryFromRecording(entries);
    if (trace === traces[0])
      expect(
        entries
          .map(({ attempt }) => attempt.durationMs)
          .sort((a, b) => (a ?? 0) - (b ?? 0)),
      ).toEqual([308425, 312707]);
    else
      expect(
        entries
          .filter(({ workItem }) => workItem.attempts.length === 2)
          .map(({ attempt }) => attempt.durationMs),
      ).toEqual([177206, 19179]);
    const captured = entries.filter(
      ({ attempt }) =>
        attempt.timingCaptured &&
        attempt.startedAt !== null &&
        attempt.endedAt !== null &&
        attempt.durationMs !== null,
    );
    expect(captured.length).toBeGreaterThan(0);
    const earliestStartedAt = captured.reduce(
      (earliest, entry) =>
        Date.parse(entry.attempt.startedAt!) < Date.parse(earliest)
          ? entry.attempt.startedAt!
          : earliest,
      captured[0]!.attempt.startedAt!,
    );
    const latestEndedAt = captured.reduce(
      (latest, entry) =>
        Date.parse(entry.attempt.endedAt!) > Date.parse(latest)
          ? entry.attempt.endedAt!
          : latest,
      captured[0]!.attempt.endedAt!,
    );

    const { host, root } = mountTrace(trace);
    try {
      await act(async () => {
        root.render(<RunTrace trace={trace} />);
      });
      expect(host.textContent).toContain(trace.work.title);
      const axis = host.querySelector<HTMLElement>('.run-trace__axis');
      expect(axis).not.toBeNull();
      expect(axis?.textContent).toContain(earliestStartedAt);
      expect(axis?.textContent).toContain(latestEndedAt);

      const attemptButtons = [
        ...host.querySelectorAll<HTMLButtonElement>(
          '[data-testid="trace-attempt"]',
        ),
      ];
      expect(attemptButtons.length).toBe(entries.length);
      const domGeometry = attemptButtons.map((button) => ({
        button,
        left: stylePercent(button, '--attempt-left'),
        width: stylePercent(button, '--attempt-width'),
      }));
      for (const { workItem, attempt } of entries) {
        const expected = expectedGeometry.get(attempt.id);
        expect(expected).toBeDefined();
        if (!expected) continue;
        const button = attemptButtons.find(
          (candidate) =>
            candidate.title === workItem.subject &&
            candidate
              .getAttribute('aria-label')
              ?.includes(`Attempt ${attempt.attemptNo}`),
        );
        expect(button).toBeDefined();
        const rendered = domGeometry.find(
          ({ button: candidate }) => candidate === button,
        );
        expect(rendered).toBeDefined();
        if (!rendered) continue;
        expect(rendered.left).toBeCloseTo(expected.left, 6);
        expect(rendered.width).toBeCloseTo(expected.width, 6);
      }
      expect(new Set(domGeometry.map(({ left }) => left)).size).toBeGreaterThan(
        1,
      );
      const laneNodes = [
        ...host.querySelectorAll<HTMLElement>('.run-trace__lane'),
      ];
      expect(laneNodes).toHaveLength(trace.actors.size);
      for (const actor of trace.actors.values()) {
        const lane = laneNodes.find(
          (candidate) =>
            candidate.querySelector('.run-trace__lane-name span')
              ?.textContent === (actor.name ?? 'Name not captured'),
        );
        expect(lane).toBeDefined();
        if (!lane) continue;
        expect(
          lane.querySelector('.run-trace__lane-name small')?.textContent,
        ).toContain('active');
        for (const entry of entries.filter(
          ({ workItem }) => workItem.actor_id === actor.id,
        )) {
          const button = attemptButtons.find(
            (candidate) =>
              candidate.title === entry.workItem.subject &&
              candidate
                .getAttribute('aria-label')
                ?.includes(`Attempt ${entry.attempt.attemptNo}`),
          );
          expect(button).toBeDefined();
          if (button) expect(lane.contains(button)).toBe(true);
        }
      }
      if (trace === traces[0]) {
        expect(laneNodes).toHaveLength(3);
        expect(
          laneNodes.map(
            (lane) =>
              lane.querySelector('.run-trace__lane-name span')?.textContent,
          ),
        ).toEqual(
          [...trace.actors.values()].map(
            (actor) => actor.name ?? 'Name not captured',
          ),
        );
      }
      expect(
        attemptButtons.every(
          (button) =>
            button.type === 'button' &&
            button.tabIndex === 0 &&
            button.getAttribute('aria-pressed') !== null,
        ),
      ).toBe(true);
      expect(host.textContent).toContain('Inspector');

      const firstEntry = entries[0];
      expect(firstEntry).toBeDefined();
      if (!firstEntry) continue;
      const firstEntryButton = attemptButtons.find(
        (button) =>
          button.title === firstEntry.workItem.subject &&
          button
            .getAttribute('aria-label')
            ?.includes(`Attempt ${firstEntry.attempt.attemptNo}`),
      );
      expect(firstEntryButton).toBeDefined();
      const selectedButton = attemptButtons.find(
        (button) => button.getAttribute('aria-pressed') === 'true',
      );
      expect(selectedButton).toBe(firstEntryButton);
      const inspector = host.querySelector<HTMLElement>(
        '#trace-inspector-heading',
      )?.parentElement;
      expect(inspector).not.toBeNull();
      expect(inspector?.textContent).toContain(firstEntry.attempt.startedAt!);
      expect(inspector?.textContent).toContain(firstEntry.attempt.endedAt!);
      const lastEntry = entries.at(-1);
      expect(lastEntry).toBeDefined();
      if (!lastEntry) continue;
      const lastEntryButton = attemptButtons.find(
        (button) =>
          button.title === lastEntry.workItem.subject &&
          button
            .getAttribute('aria-label')
            ?.includes(`Attempt ${lastEntry.attempt.attemptNo}`),
      );
      expect(lastEntryButton).toBeDefined();
      expect(lastEntryButton).not.toBe(firstEntryButton);
      if (!lastEntryButton) continue;
      await act(async () => {
        lastEntryButton.focus();
        lastEntryButton.click();
      });
      expect(lastEntryButton.getAttribute('aria-pressed')).toBe('true');
      expect(host.querySelector('#trace-inspector-heading')).not.toBeNull();
      expect(inspector?.textContent).toContain(lastEntry.attempt.startedAt!);
      expect(inspector?.textContent).toContain(lastEntry.attempt.endedAt!);

      if (trace === traces[1]) {
        const reworkItem = [...trace.workItems.values()].find(
          (workItem) => workItem.attempts.length === 2,
        );
        expect(reworkItem).toBeDefined();
        if (!reworkItem) continue;
        expect(reworkItem.attempts.map((attempt) => attempt.id)).toHaveLength(
          2,
        );
        expect(reworkItem.attempts[0]?.id).not.toBe(reworkItem.attempts[1]?.id);
        const feedbackEdges = trace.edges.filter(
          (edge) => edge.kind === 'feedback',
        );
        expect(feedbackEdges).toHaveLength(1);
        expect(feedbackEdges[0]?.attemptId).toBe(reworkItem.attempts[1]?.id);
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
