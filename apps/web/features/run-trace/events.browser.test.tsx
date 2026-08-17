import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';

import parallelRecording from '@/lib/__fixtures__/product-recordings/parallel-success.json';
import reworkRecording from '@/lib/__fixtures__/product-recordings/rework-once.json';
import { RunTrace } from './run-trace';
import { parseRecordedTrace } from './recording-test-helpers';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

function expectedActivityStatus(value: string): string {
  return value.replaceAll('_', ' ');
}

function expectedCaptureLabel(value: string): string {
  if (value === 'not_present' || value === 'not_captured')
    return 'Not captured';
  if (value === 'redacted') return 'Captured, content redacted';
  if (value === 'captured') return 'Captured';
  return expectedActivityStatus(value);
}

it('renders only recorded MCP activities with sequence and association facts', async () => {
  const cases = [
    { recording: parallelRecording, count: 56 },
    { recording: reworkRecording, count: 48 },
  ];

  for (const { recording, count } of cases) {
    const trace = parseRecordedTrace(recording);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(<RunTrace trace={trace} />);
      });
      const eventsTab = [
        ...host.querySelectorAll<HTMLButtonElement>('button'),
      ].find((button) => button.textContent?.trim() === 'Events');
      expect(eventsTab).toBeDefined();
      if (!eventsTab) continue;
      await act(async () => eventsTab.click());

      const eventButtons = [
        ...host.querySelectorAll<HTMLButtonElement>('.run-trace__event'),
      ];
      expect(eventButtons).toHaveLength(count);
      expect(
        eventButtons.map((button) =>
          Number(button.querySelector('strong')?.textContent?.replace('#', '')),
        ),
      ).toEqual(trace.mcp_activities.map((activity) => activity.sequence));
      expect(
        eventButtons.every(
          (button) =>
            button.type === 'button' &&
            button.tabIndex === 0 &&
            button.getAttribute('aria-pressed') !== null &&
            button.textContent?.includes('MCP activity:') &&
            button.textContent?.includes('Result:'),
        ),
      ).toBe(true);

      for (const [index, activity] of trace.mcp_activities.entries()) {
        const button = eventButtons[index];
        expect(button).toBeDefined();
        if (!button) continue;
        expect(button.textContent).toContain(String(activity.sequence));
        const actor = trace.actors.find(
          (candidate) => candidate.id === activity.source_refs.actor_id,
        );
        if (actor)
          expect(button.textContent).toContain(
            actor.name ?? 'Name not captured',
          );
        const item = trace.work_items.find(
          (candidate) => candidate.id === activity.source_refs.work_item_id,
        );
        if (item) expect(button.textContent).toContain(item.subject);
        else expect(button.textContent).toContain('Work Item not captured');
        expect(button.textContent).toContain(
          `MCP activity: ${expectedActivityStatus(activity.status)}`,
        );
        expect(button.textContent).toContain(
          `Result: ${expectedCaptureLabel(activity.result_capture_status)}`,
        );
      }

      const sequenceCounts = new Map<number, number>();
      for (const activity of trace.mcp_activities)
        sequenceCounts.set(
          activity.sequence,
          (sequenceCounts.get(activity.sequence) ?? 0) + 1,
        );
      const duplicateSequence = [...sequenceCounts.entries()].find(
        ([, count]) => count > 1,
      )?.[0];
      expect(duplicateSequence).toBeDefined();
      if (duplicateSequence === undefined) continue;
      const duplicateRows = eventButtons.filter(
        (button) =>
          button.querySelector('strong')?.textContent ===
          `#${duplicateSequence}`,
      );
      expect(duplicateRows.length).toBeGreaterThan(1);
      const duplicateSelection = duplicateRows[1];
      expect(duplicateSelection).toBeDefined();
      if (!duplicateSelection) continue;

      await act(async () => {
        duplicateSelection.focus();
        duplicateSelection.click();
      });
      expect(
        eventButtons.filter(
          (button) => button.getAttribute('aria-pressed') === 'true',
        ),
      ).toHaveLength(1);
      expect(duplicateSelection.getAttribute('aria-pressed')).toBe('true');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  }
});
