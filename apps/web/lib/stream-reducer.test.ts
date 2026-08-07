import { describe, expect, it } from 'vitest';

import { safeRunEvent } from './safe-run-events';
import {
  deriveToolActivityGroups,
  initialStreamProjection,
  reduceRunStreamEvent,
} from './stream-reducer';

function reduceSafeOutput(
  state: typeof initialStreamProjection,
  sequence: number,
  payload: Record<string, unknown>,
) {
  const event = safeRunEvent({ sequence, type: 'output', payload });
  expect(event).not.toBeNull();
  expect(event?.payload).toBeDefined();
  return reduceRunStreamEvent(state, event!);
}

describe('safe output to stream reducer', () => {
  it('updates one tool from running to completed when activity_id is stable', () => {
    const running = reduceSafeOutput(initialStreamProjection, 1, {
      kind: 'tool_status',
      activity_id: 'same-tool-id',
      category: 'shell',
      status: 'running',
      label: 'Run command',
      summary: 'Command is running.',
    });
    const completed = reduceSafeOutput(running, 2, {
      kind: 'tool_status',
      activity_id: 'same-tool-id',
      category: 'shell',
      status: 'completed',
      label: 'Run command',
      summary: 'Command completed.',
      exit_code: 0,
    });

    expect(Object.keys(completed.tools)).toEqual(['same-tool-id']);
    expect(completed.activityOrder).toEqual(['same-tool-id']);
    expect(completed.tools['same-tool-id']).toMatchObject({
      activityId: 'same-tool-id',
      status: 'completed',
      exitCode: 0,
    });
  });

  it('carries a child timeline item from safe output through reducer grouping', () => {
    const root = reduceSafeOutput(initialStreamProjection, 1, {
      kind: 'tool_status',
      activity_id: 'root-subagent',
      category: 'subagent',
      status: 'running',
      label: 'Delegate task',
      summary: 'Sub-agent is running.',
    });
    const withChild = reduceSafeOutput(root, 2, {
      kind: 'child_timeline_item',
      activity_id: 'child-1',
      parent_activity_id: 'root-subagent',
      item_kind: 'tool',
      status: 'completed',
      label: 'Child command',
      summary: 'Child command completed.',
      detail_kind: 'shell',
      detail_text: 'pwd',
      exit_code: 0,
    });

    expect(withChild.childrenByParent['root-subagent']).toHaveLength(1);
    expect(withChild.childrenByParent['root-subagent'][0]).toMatchObject({
      activityId: 'child-1',
      status: 'completed',
      detailText: 'pwd',
      exitCode: 0,
    });
    expect(
      deriveToolActivityGroups(
        withChild.tools,
        withChild.childrenByParent,
        withChild.activityOrder,
      ).childrenByParent['root-subagent'],
    ).toHaveLength(1);
  });
});
