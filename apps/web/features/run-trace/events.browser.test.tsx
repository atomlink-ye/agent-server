import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';

import parallelRecording from '@/lib/__fixtures__/product-recordings/parallel-success-fa77ba9.json';
import reworkRecording from '@/lib/__fixtures__/product-recordings/rework-once-fa77ba9.json';
import { RunTrace } from './run-trace';
import { parseRecordedTrace } from './recording-test-helpers';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

it('E4 renders only recorded MCP activities with sequence and association facts', async () => {
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
      const eventsTab = [...host.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent?.trim() === 'Events');
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

      const firstActivity = trace.mcp_activities[0];
      expect(firstActivity).toBeDefined();
      if (!firstActivity) continue;
      const firstButton = eventButtons[0];
      expect(firstButton?.textContent).toContain(String(firstActivity.sequence));
      const firstActor = trace.actors.find(
        (actor) => actor.id === firstActivity.source_refs.actor_id,
      );
      if (firstActor?.name) expect(firstButton?.textContent).toContain(firstActor.name);
      const firstItem = trace.work_items.find(
        (item) => item.id === firstActivity.source_refs.work_item_id,
      );
      if (firstItem) expect(firstButton?.textContent).toContain(firstItem.subject);
      const associatedActivity = trace.mcp_activities.find(
        (activity) => activity.source_refs.work_item_id,
      );
      if (associatedActivity) {
        const associatedItem = trace.work_items.find(
          (item) => item.id === associatedActivity.source_refs.work_item_id,
        );
        const associatedButton = eventButtons.find((button) =>
          button.textContent?.includes(`#${associatedActivity.sequence}`),
        );
        if (associatedItem)
          expect(associatedButton?.textContent).toContain(associatedItem.subject);
      }
      expect(firstButton?.textContent).toContain('MCP activity:');
      expect(firstButton?.textContent).toContain('Result:');

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
