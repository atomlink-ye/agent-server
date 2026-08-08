import { describe, expect, it } from 'vitest';

import * as streamReducer from './stream-reducer';

type PlannedIdentity = {
  readonly scope: 'wire' | 'local';
  readonly value: string;
};

type PlannedEntry = {
  readonly kind: string;
  readonly runId: string;
  readonly activityId: PlannedIdentity;
  readonly firstSequence: number | null;
  readonly lastSequence: number | null;
  readonly [key: string]: unknown;
};

type PlannedRun = {
  readonly lastSequence: number;
  readonly openAgentTextActivityId: PlannedIdentity | null;
  readonly entries: readonly PlannedEntry[];
};

type PlannedDiagnostic = {
  readonly code: string;
  readonly runId: string;
  readonly activityId: PlannedIdentity;
  readonly sequence: number;
  readonly [key: string]: unknown;
};

type PlannedTimelineState = {
  readonly runs: Readonly<Record<string, PlannedRun>>;
  readonly diagnostics: readonly PlannedDiagnostic[];
};

type PlannedApi = {
  readonly initialTimelineState: PlannedTimelineState;
  readonly applyTimelineEnvelope: (
    state: PlannedTimelineState,
    envelope: unknown,
  ) => PlannedTimelineState;
  readonly applyTimelineEnvelopes: (
    state: PlannedTimelineState,
    envelopes: readonly unknown[],
  ) => PlannedTimelineState;
};

function plannedApi(): PlannedApi {
  const api = streamReducer as unknown as Partial<PlannedApi>;
  expect(api.initialTimelineState).toBeDefined();
  expect(typeof api.applyTimelineEnvelope).toBe('function');
  expect(typeof api.applyTimelineEnvelopes).toBe('function');
  return api as PlannedApi;
}

function runEvent(
  runId: string,
  sequence: number,
  type: string,
  payload?: Record<string, unknown>,
) {
  return {
    runId,
    update: {
      kind: 'runEvent',
      event: {
        sequence,
        type,
        ...(payload === undefined ? {} : { payload }),
      },
    },
  };
}

function apply(
  state: PlannedTimelineState,
  envelope: unknown,
): PlannedTimelineState {
  return plannedApi().applyTimelineEnvelope(state, envelope);
}

function entries(
  state: PlannedTimelineState,
  runId: string,
): readonly PlannedEntry[] {
  return state.runs[runId]?.entries ?? [];
}

function entryByValue(
  state: PlannedTimelineState,
  runId: string,
  value: string,
): PlannedEntry | undefined {
  return entries(state, runId).find(
    (entry) => entry.activityId.value === value,
  );
}

describe('planned ordered timeline reducer (S5 Task 2 red tests)', () => {
  it('keeps one agent text entry across seq26 then thinking27/28 then seq29', () => {
    const api = plannedApi();
    let state = apply(
      api.initialTimelineState,
      runEvent('golden-run', 26, 'output', {
        kind: 'assistant_text',
        text: 'before thinking',
      }),
    );
    state = apply(
      state,
      runEvent('golden-run', 27, 'output', {
        kind: 'reasoning_progress',
        status: 'started',
      }),
    );
    state = apply(
      state,
      runEvent('golden-run', 28, 'output', {
        kind: 'reasoning_progress',
        status: 'completed',
      }),
    );
    state = apply(
      state,
      runEvent('golden-run', 29, 'output', {
        kind: 'assistant_text',
        text: 'before thinking seq29',
      }),
    );
    const textEntries = entries(state, 'golden-run').filter(
      (entry) =>
        entry.kind === 'agentText' && entry.origin === 'assistant_text',
    );
    expect(textEntries).toHaveLength(1);
    expect(textEntries[0]).toMatchObject({ text: 'before thinking seq29' });
  });

  it('isolates the same wire activity identity across runs', () => {
    const api = plannedApi();
    const stateA = apply(
      api.initialTimelineState,
      runEvent('run-a', 1, 'output', {
        kind: 'tool_status',
        activity_id: 'activity-1',
        category: 'shell',
        status: 'running',
        label: 'Run A',
        summary: 'running',
      }),
    );
    const state = apply(
      stateA,
      runEvent('run-b', 1, 'output', {
        kind: 'tool_status',
        activity_id: 'activity-1',
        category: 'shell',
        status: 'running',
        label: 'Run B',
        summary: 'running',
      }),
    );
    const a = entries(state, 'run-a');
    const b = entries(state, 'run-b');
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]).toMatchObject({
      runId: 'run-a',
      activityId: { scope: 'wire', value: 'activity-1' },
    });
    expect(b[0]).toMatchObject({
      runId: 'run-b',
      activityId: { scope: 'wire', value: 'activity-1' },
    });
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
  });

  it('rejects cross-kind wire identity collisions and bounds diagnostics', () => {
    const api = plannedApi();
    let state = apply(
      api.initialTimelineState,
      runEvent('run-a', 1, 'output', {
        kind: 'tool_status',
        activity_id: 'same-wire-id',
        category: 'shell',
        status: 'running',
        label: 'Shell',
        summary: 'safe summary',
      }),
    );
    const original = structuredClone(entries(state, 'run-a'));
    for (let sequence = 2; sequence <= 25; sequence += 1) {
      state = apply(
        state,
        runEvent('run-a', sequence, 'output', {
          kind: 'permission',
          activity_id: 'same-wire-id',
          category: 'tool',
          status: 'requested',
          summary: `secret permission body ${sequence} should not enter diagnostics`,
        }),
      );
    }
    state = apply(
      state,
      runEvent('run-a', 26, 'output', {
        kind: 'child_timeline_item',
        activity_id: 'same-wire-id',
        parent_activity_id: 'parent',
        item_kind: 'tool',
        status: 'running',
        label: 'Child',
        summary: 'secret child body should not enter diagnostics',
      }),
    );
    expect(entries(state, 'run-a')).toEqual(original);
    expect(state.runs['run-a']?.lastSequence).toBe(26);
    expect(state.diagnostics).toHaveLength(20);
    expect(
      state.diagnostics.every(
        (diagnostic) =>
          diagnostic.code === 'identity_kind_conflict' &&
          diagnostic.runId === 'run-a' &&
          diagnostic.activityId.scope === 'wire' &&
          diagnostic.activityId.value === 'same-wire-id' &&
          typeof diagnostic.sequence === 'number',
      ),
    ).toBe(true);
    expect(JSON.stringify(state.diagnostics)).not.toContain(
      'secret permission body',
    );
    expect(JSON.stringify(state.diagnostics)).not.toContain(
      'secret child body',
    );
  });

  it('handles cumulative assistant text idempotently and only accepts strict prefixes', () => {
    const api = plannedApi();
    let state = apply(
      api.initialTimelineState,
      runEvent('run-a', 1, 'output', {
        kind: 'assistant_text',
        text: 'Hello',
      }),
    );
    state = apply(
      state,
      runEvent('run-a', 2, 'output', {
        kind: 'assistant_text',
        text: 'Hello',
      }),
    );
    state = apply(
      state,
      runEvent('run-a', 3, 'output', {
        kind: 'assistant_text',
        text: 'Hello world',
      }),
    );
    const beforeNonPrefix = structuredClone(entries(state, 'run-a'));
    state = apply(
      state,
      runEvent('run-a', 4, 'output', {
        kind: 'assistant_text',
        text: 'Not a prefix',
      }),
    );
    expect(entries(state, 'run-a')).toEqual(beforeNonPrefix);
    expect(state.runs['run-a']?.lastSequence).toBe(4);
    expect(entries(state, 'run-a')).toHaveLength(1);
    expect(entries(state, 'run-a')[0]).toMatchObject({
      kind: 'agentText',
      firstSequence: 1,
      lastSequence: 3,
      text: 'Hello world',
    });
  });

  it('closes an open agent segment only for a newly introduced top-level tool', () => {
    const api = plannedApi();
    let state = apply(
      api.initialTimelineState,
      runEvent('run-a', 1, 'output', {
        kind: 'assistant_text',
        text: 'Hello',
      }),
    );
    state = apply(
      state,
      runEvent('run-a', 2, 'output', {
        kind: 'tool_status',
        activity_id: 'tool-1',
        category: 'shell',
        status: 'running',
        label: 'Shell',
        summary: 'running',
      }),
    );
    state = apply(
      state,
      runEvent('run-a', 3, 'output', {
        kind: 'tool_status',
        activity_id: 'tool-1',
        category: 'shell',
        status: 'completed',
        label: 'Shell',
        summary: 'completed',
      }),
    );
    expect(entries(state, 'run-a')).toHaveLength(2);
    expect(state.runs['run-a']?.openAgentTextActivityId).toBeNull();
    state = apply(
      state,
      runEvent('run-a', 4, 'output', {
        kind: 'assistant_text',
        text: 'Hello world',
      }),
    );
    expect(entries(state, 'run-a')).toHaveLength(3);
    expect(entries(state, 'run-a')[0]).toMatchObject({
      kind: 'agentText',
      firstSequence: 1,
      lastSequence: 1,
      text: 'Hello',
    });
    expect(entries(state, 'run-a')[2]).toMatchObject({
      kind: 'agentText',
      firstSequence: 4,
      lastSequence: 4,
      text: 'Hello world',
    });
    expect(state.runs['run-a']?.openAgentTextActivityId).toEqual(
      entries(state, 'run-a')[2]?.activityId,
    );
  });

  it('keeps thinking, approval, usage, lifecycle, child, and existing-tool updates in one agent entry', () => {
    const api = plannedApi();
    let state = apply(
      api.initialTimelineState,
      runEvent('run-a', 1, 'output', {
        kind: 'tool_status',
        activity_id: 'tool-1',
        category: 'shell',
        status: 'running',
        label: 'Shell',
        summary: 'running',
      }),
    );
    state = apply(
      state,
      runEvent('run-a', 2, 'output', {
        kind: 'assistant_text',
        text: 'Hello world',
      }),
    );
    state = apply(
      state,
      runEvent('run-a', 3, 'output', { kind: 'usage', input_tokens: 1 }),
    );
    state = apply(
      state,
      runEvent('run-a', 4, 'output', {
        kind: 'assistant_text',
        text: 'Hello world, continued',
      }),
    );
    state = apply(
      state,
      runEvent('run-a', 5, 'output', {
        kind: 'reasoning_progress',
        status: 'started',
        text: 'thinking',
      }),
    );
    state = apply(
      state,
      runEvent('run-a', 6, 'output', {
        kind: 'reasoning_progress',
        status: 'completed',
        text: 'thinking done',
      }),
    );
    state = apply(
      state,
      runEvent('run-a', 7, 'output', {
        kind: 'permission',
        activity_id: 'permission-1',
        category: 'tool',
        status: 'requested',
        summary: 'approve',
      }),
    );
    state = apply(
      state,
      runEvent('run-a', 8, 'output', {
        kind: 'permission',
        activity_id: 'permission-1',
        category: 'tool',
        status: 'resolved',
        decision: 'allowed',
        summary: 'approved',
      }),
    );
    state = apply(
      state,
      runEvent('run-a', 9, 'output', {
        kind: 'child_timeline_item',
        activity_id: 'child-1',
        parent_activity_id: 'tool-1',
        item_kind: 'tool',
        status: 'running',
        label: 'Child',
        summary: 'child',
      }),
    );
    state = apply(state, runEvent('run-a', 10, 'started'));
    state = apply(
      state,
      runEvent('run-a', 11, 'output', {
        kind: 'tool_status',
        activity_id: 'tool-1',
        category: 'shell',
        status: 'completed',
        label: 'Shell',
        summary: 'completed',
      }),
    );
    expect(
      entries(state, 'run-a').filter((entry) => entry.kind === 'agentText'),
    ).toHaveLength(1);
    expect(entryByValue(state, 'run-a', 'agent-text:2')).toMatchObject({
      text: 'Hello world, continued',
      firstSequence: 2,
      lastSequence: 4,
    });
    expect(state.runs['run-a']?.openAgentTextActivityId).toEqual({
      scope: 'local',
      value: 'agent-text:2',
    });
  });

  it('creates and advances reasoning spans, including completed without started', () => {
    const api = plannedApi();
    let missing = apply(
      api.initialTimelineState,
      runEvent('missing', 1, 'output', {
        kind: 'reasoning_progress',
        status: 'completed',
        text: 'done',
      }),
    );
    expect(entries(missing, 'missing')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'thinking',
          activityId: { scope: 'local', value: 'thinking:1' },
          firstSequence: 1,
          lastSequence: 1,
        }),
      ]),
    );
    let state = apply(
      api.initialTimelineState,
      runEvent('run-a', 1, 'output', {
        kind: 'reasoning_progress',
        status: 'started',
        text: 'A',
      }),
    );
    state = apply(
      state,
      runEvent('run-a', 2, 'output', {
        kind: 'reasoning_progress',
        status: 'started',
        text: 'AB',
      }),
    );
    state = apply(
      state,
      runEvent('run-a', 3, 'output', {
        kind: 'reasoning_progress',
        status: 'completed',
        text: 'ABC',
      }),
    );
    state = apply(
      state,
      runEvent('run-a', 4, 'output', {
        kind: 'reasoning_progress',
        status: 'started',
        text: 'new',
      }),
    );
    expect(entries(state, 'run-a')).toHaveLength(2);
    expect(entries(state, 'run-a')[0]).toMatchObject({
      kind: 'thinking',
      firstSequence: 1,
      lastSequence: 3,
      text: 'ABC',
    });
    expect(entries(state, 'run-a')[1]).toMatchObject({
      kind: 'thinking',
      firstSequence: 4,
      lastSequence: 4,
      text: 'new',
    });
  });

  it('guards monotonic tool and approval statuses', () => {
    const api = plannedApi();
    let state = apply(
      api.initialTimelineState,
      runEvent('run-a', 1, 'output', {
        kind: 'tool_status',
        activity_id: 'tool-1',
        category: 'shell',
        status: 'running',
        label: 'Shell',
        summary: 'running',
      }),
    );
    state = apply(
      state,
      runEvent('run-a', 2, 'output', {
        kind: 'tool_status',
        activity_id: 'tool-1',
        category: 'shell',
        status: 'completed',
        label: 'Shell',
        summary: 'completed',
      }),
    );
    const completed = structuredClone(entries(state, 'run-a'));
    state = apply(
      state,
      runEvent('run-a', 3, 'output', {
        kind: 'tool_status',
        activity_id: 'tool-1',
        category: 'shell',
        status: 'running',
        label: 'rewritten',
        summary: 'backwards',
      }),
    );
    state = apply(
      state,
      runEvent('run-a', 4, 'output', {
        kind: 'tool_status',
        activity_id: 'tool-1',
        category: 'shell',
        status: 'failed',
        label: 'rewritten',
        summary: 'backwards',
      }),
    );
    expect(entries(state, 'run-a')).toEqual(completed);
    state = apply(
      state,
      runEvent('run-a', 5, 'output', {
        kind: 'permission',
        activity_id: 'permission-1',
        category: 'tool',
        status: 'requested',
        summary: 'request',
      }),
    );
    state = apply(
      state,
      runEvent('run-a', 6, 'output', {
        kind: 'permission',
        activity_id: 'permission-1',
        category: 'tool',
        status: 'resolved',
        decision: 'allowed',
        summary: 'resolved',
      }),
    );
    const resolved = structuredClone(entries(state, 'run-a'));
    state = apply(
      state,
      runEvent('run-a', 7, 'output', {
        kind: 'permission',
        activity_id: 'permission-1',
        category: 'tool',
        status: 'requested',
        summary: 'backwards',
      }),
    );
    expect(entries(state, 'run-a')).toEqual(resolved);
  });

  it('maps child item kinds while preserving wire identity and never closing top-level agent text', () => {
    const api = plannedApi();
    let state = apply(
      api.initialTimelineState,
      runEvent('run-a', 1, 'output', {
        kind: 'tool_status',
        activity_id: 'parent',
        category: 'subagent',
        status: 'running',
        label: 'Parent',
        summary: 'parent',
      }),
    );
    state = apply(
      state,
      runEvent('run-a', 2, 'output', {
        kind: 'assistant_text',
        text: 'Top level',
      }),
    );
    for (const [sequence, itemKind, activityId] of [
      [3, 'assistant', 'child-a'],
      [4, 'reasoning', 'child-r'],
      [5, 'tool', 'child-t'],
    ] as const) {
      state = apply(
        state,
        runEvent('run-a', sequence, 'output', {
          kind: 'child_timeline_item',
          activity_id: activityId,
          parent_activity_id: 'parent',
          item_kind: itemKind,
          status: 'running',
          label: itemKind,
          summary: itemKind,
          detail_kind: 'shell',
          detail_text: `${itemKind}-detail`,
        }),
      );
    }
    expect(entries(state, 'run-a')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'agentText',
          activityId: { scope: 'wire', value: 'child-a' },
          parentActivityId: { scope: 'wire', value: 'parent' },
        }),
        expect.objectContaining({
          kind: 'thinking',
          activityId: { scope: 'wire', value: 'child-r' },
          parentActivityId: { scope: 'wire', value: 'parent' },
        }),
        expect.objectContaining({
          kind: 'tool',
          activityId: { scope: 'wire', value: 'child-t' },
          parentActivityId: { scope: 'wire', value: 'parent' },
          detailText: 'tool-detail',
        }),
      ]),
    );
    expect(state.runs['run-a']?.openAgentTextActivityId).toEqual({
      scope: 'local',
      value: 'agent-text:2',
    });

    const childFirst = apply(
      api.initialTimelineState,
      runEvent('child-first', 1, 'output', {
        kind: 'child_timeline_item',
        activity_id: 'orphan-child',
        parent_activity_id: 'late-parent',
        item_kind: 'tool',
        status: 'completed',
        label: 'orphan',
        summary: 'orphan',
      }),
    );
    const childThenParent = apply(
      childFirst,
      runEvent('child-first', 2, 'output', {
        kind: 'tool_status',
        activity_id: 'late-parent',
        category: 'subagent',
        status: 'completed',
        label: 'late parent',
        summary: 'late parent',
      }),
    );
    expect(entries(childThenParent, 'child-first')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          activityId: { scope: 'wire', value: 'orphan-child' },
          parentActivityId: { scope: 'wire', value: 'late-parent' },
        }),
      ]),
    );
  });

  it('ignores late run events after terminal while canonical text can save the last agent segment', () => {
    const api = plannedApi();
    let state = apply(
      api.initialTimelineState,
      runEvent('run-a', 1, 'output', { kind: 'assistant_text', text: 'draft' }),
    );
    state = apply(state, runEvent('run-a', 2, 'succeeded'));
    state = apply(
      state,
      runEvent('run-a', 3, 'output', {
        kind: 'assistant_text',
        text: 'late text',
      }),
    );
    expect(state.runs['run-a']?.lastSequence).toBe(2);
    state = apply(state, {
      runId: 'run-a',
      update: {
        kind: 'canonicalAgentText',
        text: 'saved',
        messageId: 'assistant-1',
      },
    });
    expect(entries(state, 'run-a')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'agentText',
          text: 'saved',
          status: 'saved',
          messageId: 'assistant-1',
        }),
      ]),
    );
    const canonicalOnly = apply(api.initialTimelineState, {
      runId: 'run-b',
      update: {
        kind: 'canonicalAgentText',
        text: 'saved',
        messageId: 'assistant-2',
      },
    });
    expect(entries(canonicalOnly, 'run-b')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'agentText',
          activityId: { scope: 'local', value: 'agent-text:canonical' },
          status: 'saved',
          messageId: 'assistant-2',
        }),
      ]),
    );
  });

  it('canonicalizes only the last top-level agent segment for a reused message id', () => {
    const api = plannedApi();
    let state = apply(
      api.initialTimelineState,
      runEvent('run-a', 1, 'output', {
        kind: 'assistant_text',
        text: 'segment A',
      }),
    );
    state = apply(state, {
      runId: 'run-a',
      update: {
        kind: 'canonicalAgentText',
        text: 'segment A saved',
        messageId: 'same-message',
      },
    });
    const segmentA = structuredClone(
      entryByValue(state, 'run-a', 'agent-text:1'),
    );
    state = apply(
      state,
      runEvent('run-a', 2, 'output', {
        kind: 'tool_status',
        activity_id: 'tool-between',
        category: 'shell',
        status: 'running',
        label: 'Shell',
        summary: 'between segments',
      }),
    );
    state = apply(
      state,
      runEvent('run-a', 3, 'output', {
        kind: 'assistant_text',
        text: 'segment B',
      }),
    );
    state = apply(state, {
      runId: 'run-a',
      update: {
        kind: 'canonicalAgentText',
        text: 'segment B saved',
        messageId: 'same-message',
      },
    });
    expect(entryByValue(state, 'run-a', 'agent-text:1')).toEqual(segmentA);
    expect(entryByValue(state, 'run-a', 'agent-text:3')).toMatchObject({
      kind: 'agentText',
      text: 'segment B saved',
      status: 'saved',
      messageId: 'same-message',
    });
  });

  it('allows same-terminal updates to fill tool, child-tool, and approval details', () => {
    const api = plannedApi();
    let toolState = apply(
      api.initialTimelineState,
      runEvent('tool-run', 1, 'output', {
        kind: 'tool_status',
        activity_id: 'tool-terminal',
        category: 'shell',
        status: 'running',
        label: 'Shell',
        summary: 'running',
      }),
    );
    toolState = apply(
      toolState,
      runEvent('tool-run', 2, 'output', {
        kind: 'tool_status',
        activity_id: 'tool-terminal',
        category: 'shell',
        status: 'completed',
        label: 'Shell',
        summary: 'completed',
      }),
    );
    toolState = apply(
      toolState,
      runEvent('tool-run', 3, 'output', {
        kind: 'tool_status',
        activity_id: 'tool-terminal',
        category: 'shell',
        status: 'completed',
        label: 'Shell',
        summary: 'completed with details',
        detail_kind: 'shell',
        detail_text: 'TOOL_OK',
        exit_code: 0,
      }),
    );
    const completedTool = structuredClone(entries(toolState, 'tool-run'));
    toolState = apply(
      toolState,
      runEvent('tool-run', 4, 'output', {
        kind: 'tool_status',
        activity_id: 'tool-terminal',
        category: 'shell',
        status: 'failed',
        label: 'rewritten',
        summary: 'must be rejected',
      }),
    );
    expect(entries(toolState, 'tool-run')).toHaveLength(1);
    expect(entries(toolState, 'tool-run')[0]).toMatchObject({
      status: 'completed',
      detailText: 'TOOL_OK',
      exitCode: 0,
    });
    expect(entries(toolState, 'tool-run')).toEqual(completedTool);

    let childState = apply(
      api.initialTimelineState,
      runEvent('child-run', 1, 'output', {
        kind: 'child_timeline_item',
        activity_id: 'child-terminal',
        parent_activity_id: 'parent',
        item_kind: 'tool',
        status: 'running',
        label: 'Child shell',
        summary: 'running',
      }),
    );
    childState = apply(
      childState,
      runEvent('child-run', 2, 'output', {
        kind: 'child_timeline_item',
        activity_id: 'child-terminal',
        parent_activity_id: 'parent',
        item_kind: 'tool',
        status: 'completed',
        label: 'Child shell',
        summary: 'completed',
      }),
    );
    childState = apply(
      childState,
      runEvent('child-run', 3, 'output', {
        kind: 'child_timeline_item',
        activity_id: 'child-terminal',
        parent_activity_id: 'parent',
        item_kind: 'tool',
        status: 'completed',
        label: 'Child shell',
        summary: 'completed with details',
        detail_kind: 'shell',
        detail_text: 'CHILD_OK',
        exit_code: 0,
      }),
    );
    const completedChild = structuredClone(entries(childState, 'child-run'));
    childState = apply(
      childState,
      runEvent('child-run', 4, 'output', {
        kind: 'child_timeline_item',
        activity_id: 'child-terminal',
        parent_activity_id: 'parent',
        item_kind: 'tool',
        status: 'failed',
        label: 'rewritten',
        summary: 'must be rejected',
      }),
    );
    expect(entries(childState, 'child-run')).toHaveLength(1);
    expect(entries(childState, 'child-run')[0]).toMatchObject({
      status: 'completed',
      detailText: 'CHILD_OK',
      exitCode: 0,
    });
    expect(entries(childState, 'child-run')).toEqual(completedChild);

    let approvalState = apply(
      api.initialTimelineState,
      runEvent('approval-run', 1, 'output', {
        kind: 'permission',
        activity_id: 'approval-terminal',
        category: 'tool',
        status: 'requested',
        summary: 'requested',
      }),
    );
    approvalState = apply(
      approvalState,
      runEvent('approval-run', 2, 'output', {
        kind: 'permission',
        activity_id: 'approval-terminal',
        category: 'tool',
        status: 'resolved',
        summary: 'resolved',
      }),
    );
    approvalState = apply(
      approvalState,
      runEvent('approval-run', 3, 'output', {
        kind: 'permission',
        activity_id: 'approval-terminal',
        category: 'tool',
        status: 'resolved',
        decision: 'allowed',
        summary: 'resolved with decision',
      }),
    );
    const resolvedApproval = structuredClone(
      entries(approvalState, 'approval-run'),
    );
    approvalState = apply(
      approvalState,
      runEvent('approval-run', 4, 'output', {
        kind: 'permission',
        activity_id: 'approval-terminal',
        category: 'tool',
        status: 'requested',
        summary: 'must be rejected',
      }),
    );
    expect(entries(approvalState, 'approval-run')).toHaveLength(1);
    expect(entries(approvalState, 'approval-run')[0]).toMatchObject({
      kind: 'approval',
      status: 'resolved',
      decision: 'allowed',
    });
    expect(entries(approvalState, 'approval-run')).toEqual(resolvedApproval);
  });

  it('coalesces consecutive reasoning completions before opening a new span', () => {
    const api = plannedApi();
    let state = apply(
      api.initialTimelineState,
      runEvent('reasoning-run', 1, 'output', {
        kind: 'reasoning_progress',
        status: 'completed',
        text: 'first completed',
      }),
    );
    state = apply(
      state,
      runEvent('reasoning-run', 2, 'output', {
        kind: 'reasoning_progress',
        status: 'completed',
        text: 'second completed',
      }),
    );
    state = apply(
      state,
      runEvent('reasoning-run', 3, 'output', {
        kind: 'reasoning_progress',
        status: 'started',
        text: 'new span',
      }),
    );
    expect(entries(state, 'reasoning-run')).toHaveLength(2);
    expect(entries(state, 'reasoning-run')[0]).toMatchObject({
      kind: 'thinking',
      activityId: { scope: 'local', value: 'thinking:1' },
      firstSequence: 1,
      lastSequence: 2,
      status: 'completed',
      text: 'second completed',
    });
    expect(entries(state, 'reasoning-run')[1]).toMatchObject({
      kind: 'thinking',
      activityId: { scope: 'local', value: 'thinking:3' },
      firstSequence: 3,
      lastSequence: 3,
      status: 'started',
      text: 'new span',
    });
  });

  it('treats prototype-looking run ids as independent own runs', () => {
    const api = plannedApi();
    const runIds = ['__proto__', 'constructor', 'toString'];
    const state = runIds.reduce(
      (current, runId, index) =>
        apply(
          current,
          runEvent(runId, 1, 'output', {
            kind: 'assistant_text',
            text: `text for ${runId}`,
          }),
        ),
      api.initialTimelineState,
    );
    for (const runId of runIds) {
      expect(Object.hasOwn(state.runs, runId)).toBe(true);
      expect(state.runs[runId]?.lastSequence).toBe(1);
      expect(entries(state, runId)).toHaveLength(1);
      expect(entries(state, runId)[0]).toMatchObject({
        runId,
        text: `text for ${runId}`,
      });
    }
  });

  it('advances only the addressed run sequence for unknown or malformed outputs', () => {
    const api = plannedApi();
    let state = apply(
      api.initialTimelineState,
      runEvent('run-a', 5, 'output', { kind: 'unknown_kind', body: 'ignored' }),
    );
    state = apply(
      state,
      runEvent('run-a', 5, 'output', {
        kind: 'assistant_text',
        text: 'duplicate sequence ignored',
      }),
    );
    state = apply(state, runEvent('run-a', 6, 'output', { malformed: true }));
    state = apply(
      state,
      runEvent('run-b', 1, 'output', {
        kind: 'assistant_text',
        text: 'independent run',
      }),
    );
    expect(state.runs['run-a']?.lastSequence).toBe(6);
    expect(entries(state, 'run-a')).toHaveLength(0);
    expect(state.runs['run-b']?.lastSequence).toBe(1);
    expect(entries(state, 'run-b')).toHaveLength(1);
  });

  it('deduplicates canonical prompts by message id without sequence advancement', () => {
    const api = plannedApi();
    const prompt = {
      runId: 'run-a',
      update: { kind: 'prompt', text: 'Prompt text', messageId: 'message-1' },
    };
    let state = apply(api.initialTimelineState, prompt);
    state = apply(state, prompt);
    state = apply(state, {
      runId: 'run-a',
      update: { kind: 'prompt', text: 'Second prompt', messageId: 'message-2' },
    });
    expect(state.runs['run-a']?.lastSequence).toBe(0);
    expect(entries(state, 'run-a')).toHaveLength(2);
    expect(
      entries(state, 'run-a').filter(
        (entry) => entry.activityId.value === 'prompt:message-1',
      ),
    ).toHaveLength(1);
    expect(entries(state, 'run-a')[0]).toMatchObject({
      kind: 'prompt',
      firstSequence: null,
      lastSequence: null,
      messageId: 'message-1',
    });
  });

  it('keeps apply pure for initial state, input state, and entries arrays', () => {
    const api = plannedApi();
    const initialSnapshot = structuredClone(api.initialTimelineState);
    const input = apply(
      api.initialTimelineState,
      runEvent('run-a', 1, 'output', { kind: 'assistant_text', text: 'Hello' }),
    );
    const inputSnapshot = structuredClone(input);
    const inputEntries = input.runs['run-a']?.entries;
    const output = apply(
      input,
      runEvent('run-a', 2, 'output', {
        kind: 'assistant_text',
        text: 'Hello world',
      }),
    );
    expect(api.initialTimelineState).toEqual(initialSnapshot);
    expect(input).toEqual(inputSnapshot);
    expect(output).not.toBe(input);
    expect(output.runs['run-a']?.entries).not.toBe(inputEntries);
    expect(output.runs['run-a']?.entries).not.toBe(
      api.initialTimelineState.runs['run-a']?.entries,
    );
  });
});

type PlannedSelectorApi = {
  readonly selectActivityEntries: (
    state: PlannedTimelineState,
    runId: string,
  ) => readonly PlannedEntry[];
  readonly selectChildEntriesByParent: (
    state: PlannedTimelineState,
    runId: string,
  ) => ReadonlyMap<string, readonly PlannedEntry[]>;
  readonly selectCurrentLifecycle: (
    state: PlannedTimelineState,
    runId: string,
  ) => PlannedEntry | null;
  readonly selectTerminalLifecycle: (
    state: PlannedTimelineState,
    runId: string,
  ) => PlannedEntry | null;
  readonly selectUsageEntry: (
    state: PlannedTimelineState,
    runId: string,
  ) => PlannedEntry | null;
  readonly selectFinalAgentText: (
    state: PlannedTimelineState,
    runId: string,
  ) => PlannedEntry | null;
  readonly selectPromptEntries: (
    state: PlannedTimelineState,
    runId: string,
  ) => readonly PlannedEntry[];
  readonly selectAgentTextEntries: (
    state: PlannedTimelineState,
    runId: string,
  ) => readonly PlannedEntry[];
};

function plannedSelectors(): PlannedSelectorApi {
  const api = streamReducer as unknown as Partial<PlannedSelectorApi>;
  for (const name of [
    'selectActivityEntries',
    'selectChildEntriesByParent',
    'selectCurrentLifecycle',
    'selectTerminalLifecycle',
    'selectUsageEntry',
    'selectFinalAgentText',
    'selectPromptEntries',
    'selectAgentTextEntries',
  ] as const) {
    expect(typeof api[name]).toBe('function');
  }
  return api as PlannedSelectorApi;
}

function selectorFixture(runId = 'selector-run'): PlannedTimelineState {
  const api = plannedApi();
  let state = apply(api.initialTimelineState, {
    runId,
    update: { kind: 'prompt', text: 'Inspect the repository', messageId: 'p1' },
  });
  state = apply(state, runEvent(runId, 1, 'started'));
  state = apply(
    state,
    runEvent(runId, 2, 'output', {
      kind: 'reasoning_progress',
      status: 'completed',
      text: 'first thought',
    }),
  );
  state = apply(
    state,
    runEvent(runId, 3, 'output', {
      kind: 'child_timeline_item',
      activity_id: 'child-tool',
      parent_activity_id: '__proto__',
      item_kind: 'tool',
      status: 'running',
      label: 'Child command',
      summary: 'child tool',
    }),
  );
  state = apply(
    state,
    runEvent(runId, 4, 'output', {
      kind: 'tool_status',
      activity_id: '__proto__',
      category: 'subagent',
      status: 'running',
      label: 'Delegate task',
      summary: 'parent tool',
    }),
  );
  state = apply(
    state,
    runEvent(runId, 5, 'output', {
      kind: 'assistant_text',
      text: 'Agent A',
    }),
  );
  state = apply(
    state,
    runEvent(runId, 6, 'output', {
      kind: 'child_timeline_item',
      activity_id: 'child-assistant',
      parent_activity_id: '__proto__',
      item_kind: 'assistant',
      status: 'completed',
      label: 'Child response',
      summary: 'child assistant',
    }),
  );
  state = apply(
    state,
    runEvent(runId, 7, 'output', {
      kind: 'child_timeline_item',
      activity_id: 'child-reasoning',
      parent_activity_id: '__proto__',
      item_kind: 'reasoning',
      status: 'completed',
      label: 'Child reasoning',
      summary: 'child reasoning',
    }),
  );
  state = apply(
    state,
    runEvent(runId, 8, 'output', {
      kind: 'permission',
      activity_id: 'approval-1',
      category: 'tool',
      status: 'requested',
      summary: 'Approve command',
    }),
  );
  state = apply(
    state,
    runEvent(runId, 9, 'output', {
      kind: 'usage',
      input_tokens: 10,
      output_tokens: 2,
    }),
  );
  state = apply(
    state,
    runEvent(runId, 10, 'output', {
      kind: 'assistant_text',
      text: 'Agent A extended',
    }),
  );
  state = apply(
    state,
    runEvent(runId, 11, 'output', {
      kind: 'tool_status',
      activity_id: 'tool-2',
      category: 'shell',
      status: 'running',
      label: 'Second command',
      summary: 'second top-level tool',
    }),
  );
  state = apply(
    state,
    runEvent(runId, 12, 'output', {
      kind: 'assistant_text',
      text: 'Agent B',
    }),
  );
  state = apply(
    state,
    runEvent(runId, 13, 'output', {
      kind: 'reasoning_progress',
      status: 'started',
      text: 'second thought',
    }),
  );
  state = apply(
    state,
    runEvent(runId, 14, 'output', {
      kind: 'usage',
      output_tokens: 3,
      total_cost_usd: 0.42,
    }),
  );
  return apply(state, runEvent(runId, 15, 'succeeded'));
}

describe('planned timeline selectors (S5 Task 3 red tests)', () => {
  it('returns only top-level activity entries in first-inserted order', () => {
    const state = selectorFixture();
    const entries = plannedSelectors().selectActivityEntries(
      state,
      'selector-run',
    );

    expect(entries).toHaveLength(6);
    expect(
      entries.map((entry) => [
        entry.kind,
        entry.activityId.value,
        entry.firstSequence,
        entry.lastSequence,
      ]),
    ).toEqual([
      ['thinking', 'thinking:2', 2, 2],
      ['tool', '__proto__', 4, 4],
      ['approval', 'approval-1', 8, 8],
      ['usage', 'usage', 9, 14],
      ['tool', 'tool-2', 11, 11],
      ['thinking', 'thinking:13', 13, 13],
    ]);
    expect(
      entries.every(
        (entry) =>
          (entry.kind === 'thinking' &&
            entry.origin === 'reasoning_progress') ||
          (entry.kind === 'tool' && entry.origin === 'tool_status') ||
          entry.kind === 'approval' ||
          entry.kind === 'usage',
      ),
    ).toBe(true);
    expect(entries.some((entry) => entry.kind === 'prompt')).toBe(false);
    expect(
      entries.some(
        (entry) =>
          entry.kind === 'agentText' ||
          ('origin' in entry && entry.origin === 'child_timeline_item'),
      ),
    ).toBe(false);
    expect(entries[3]).toMatchObject({
      kind: 'usage',
      firstSequence: 9,
      lastSequence: 14,
      usage: { inputTokens: 10, outputTokens: 3, totalCostUsd: 0.42 },
    });
  });

  it('groups children by raw parent id without mixing top-level entries', () => {
    const state = selectorFixture();
    const children = plannedSelectors().selectChildEntriesByParent(
      state,
      'selector-run',
    );

    expect(children).toBeInstanceOf(Map);
    expect([...children.keys()]).toEqual(['__proto__']);
    expect(children.get('__proto__')).toEqual([
      expect.objectContaining({
        kind: 'tool',
        origin: 'child_timeline_item',
        activityId: { scope: 'wire', value: 'child-tool' },
        parentActivityId: { scope: 'wire', value: '__proto__' },
        firstSequence: 3,
      }),
      expect.objectContaining({
        kind: 'agentText',
        origin: 'child_timeline_item',
        activityId: { scope: 'wire', value: 'child-assistant' },
        parentActivityId: { scope: 'wire', value: '__proto__' },
        firstSequence: 6,
      }),
      expect.objectContaining({
        kind: 'thinking',
        origin: 'child_timeline_item',
        activityId: { scope: 'wire', value: 'child-reasoning' },
        parentActivityId: { scope: 'wire', value: '__proto__' },
        firstSequence: 7,
      }),
    ]);
    expect(
      [...children.values()]
        .flat()
        .every((entry) =>
          'origin' in entry ? entry.origin === 'child_timeline_item' : false,
        ),
    ).toBe(true);
  });

  it('groups parent-linked legacy tool entries as children even before their parent', () => {
    const api = plannedSelectors();
    let state = apply(
      plannedApi().initialTimelineState,
      runEvent('legacy-child-run', 1, 'output', {
        kind: 'tool_status',
        activity_id: 'legacy-child',
        parent_activity_id: 'parent',
        category: 'shell',
        status: 'completed',
        label: 'Legacy child command',
        summary: 'legacy child complete',
        detail_kind: 'shell',
        detail_text: 'legacy output',
        exit_code: 0,
      }),
    );
    state = apply(
      state,
      runEvent('legacy-child-run', 2, 'output', {
        kind: 'tool_status',
        activity_id: 'parent',
        category: 'subagent',
        status: 'running',
        label: 'Parent task',
        summary: 'parent running',
      }),
    );
    state = apply(
      state,
      runEvent('legacy-child-run', 3, 'output', {
        kind: 'child_timeline_item',
        activity_id: 'timeline-child',
        parent_activity_id: 'parent',
        item_kind: 'assistant',
        status: 'completed',
        label: 'Timeline child',
        summary: 'timeline child complete',
      }),
    );

    expect(api.selectActivityEntries(state, 'legacy-child-run')).toEqual([
      expect.objectContaining({
        kind: 'tool',
        origin: 'tool_status',
        activityId: { scope: 'wire', value: 'parent' },
        firstSequence: 2,
      }),
    ]);
    expect(
      api.selectChildEntriesByParent(state, 'legacy-child-run').get('parent'),
    ).toEqual([
      expect.objectContaining({
        kind: 'tool',
        origin: 'tool_status',
        activityId: { scope: 'wire', value: 'legacy-child' },
        parentActivityId: { scope: 'wire', value: 'parent' },
        sourceActivityId: 'legacy-child',
        firstSequence: 1,
        lastSequence: 1,
        category: 'shell',
        status: 'completed',
        label: 'Legacy child command',
        summary: 'legacy child complete',
        detailKind: 'shell',
        detailText: 'legacy output',
        exitCode: 0,
      }),
      expect.objectContaining({
        kind: 'agentText',
        origin: 'child_timeline_item',
        activityId: { scope: 'wire', value: 'timeline-child' },
        parentActivityId: { scope: 'wire', value: 'parent' },
        firstSequence: 3,
      }),
    ]);
  });

  it('selects the last lifecycle and only a terminal lifecycle when present', () => {
    const api = plannedSelectors();
    const state = selectorFixture();
    expect(api.selectCurrentLifecycle(state, 'selector-run')).toMatchObject({
      kind: 'lifecycle',
      status: 'succeeded',
      firstSequence: 15,
      lastSequence: 15,
    });
    expect(api.selectTerminalLifecycle(state, 'selector-run')).toMatchObject({
      kind: 'lifecycle',
      status: 'succeeded',
    });

    const startedOnly = apply(
      plannedApi().initialTimelineState,
      runEvent('started-only', 1, 'started'),
    );
    expect(
      api.selectCurrentLifecycle(startedOnly, 'started-only'),
    ).toMatchObject({ status: 'started' });
    expect(api.selectTerminalLifecycle(startedOnly, 'started-only')).toBeNull();
    expect(api.selectCurrentLifecycle(state, 'missing-run')).toBeNull();
    expect(api.selectTerminalLifecycle(state, 'missing-run')).toBeNull();
  });

  it('returns the merged usage entry while preserving its first sequence', () => {
    const state = selectorFixture();
    expect(
      plannedSelectors().selectUsageEntry(state, 'selector-run'),
    ).toMatchObject({
      kind: 'usage',
      activityId: { scope: 'local', value: 'usage' },
      firstSequence: 9,
      lastSequence: 14,
      usage: { inputTokens: 10, outputTokens: 3, totalCostUsd: 0.42 },
    });
    expect(
      plannedSelectors().selectUsageEntry(state, 'missing-run'),
    ).toBeNull();
  });

  it('selects only top-level agent text and keeps prompt order stable', () => {
    const api = plannedSelectors();
    const state = selectorFixture();
    expect(api.selectFinalAgentText(state, 'selector-run')).toMatchObject({
      kind: 'agentText',
      origin: 'assistant_text',
      activityId: { scope: 'local', value: 'agent-text:12' },
      text: 'Agent B',
      firstSequence: 12,
      lastSequence: 12,
    });
    expect(api.selectAgentTextEntries(state, 'selector-run')).toEqual([
      expect.objectContaining({
        kind: 'agentText',
        origin: 'assistant_text',
        activityId: { scope: 'local', value: 'agent-text:5' },
        text: 'Agent A extended',
        firstSequence: 5,
        lastSequence: 10,
      }),
      expect.objectContaining({
        kind: 'agentText',
        origin: 'assistant_text',
        activityId: { scope: 'local', value: 'agent-text:12' },
        text: 'Agent B',
      }),
    ]);
    expect(
      api
        .selectAgentTextEntries(state, 'selector-run')
        .every(
          (entry) =>
            entry.kind === 'agentText' && entry.origin === 'assistant_text',
        ),
    ).toBe(true);
    expect(api.selectPromptEntries(state, 'selector-run')).toEqual([
      expect.objectContaining({
        kind: 'prompt',
        text: 'Inspect the repository',
        messageId: 'p1',
        firstSequence: null,
        lastSequence: null,
      }),
    ]);
  });

  it('returns empty or null values for missing runs and remains pure across calls', () => {
    const api = plannedSelectors();
    const state = selectorFixture();
    const snapshot = structuredClone(state);
    const first = {
      activity: api.selectActivityEntries(state, 'missing-run'),
      children: api.selectChildEntriesByParent(state, 'missing-run'),
      lifecycle: api.selectCurrentLifecycle(state, 'missing-run'),
      terminal: api.selectTerminalLifecycle(state, 'missing-run'),
      usage: api.selectUsageEntry(state, 'missing-run'),
      finalText: api.selectFinalAgentText(state, 'missing-run'),
      prompts: api.selectPromptEntries(state, 'missing-run'),
      agentText: api.selectAgentTextEntries(state, 'missing-run'),
    };
    const second = {
      activity: api.selectActivityEntries(state, 'missing-run'),
      children: api.selectChildEntriesByParent(state, 'missing-run'),
      lifecycle: api.selectCurrentLifecycle(state, 'missing-run'),
      terminal: api.selectTerminalLifecycle(state, 'missing-run'),
      usage: api.selectUsageEntry(state, 'missing-run'),
      finalText: api.selectFinalAgentText(state, 'missing-run'),
      prompts: api.selectPromptEntries(state, 'missing-run'),
      agentText: api.selectAgentTextEntries(state, 'missing-run'),
    };
    expect(first.activity).toEqual([]);
    expect(first.children).toEqual(new Map());
    expect(first.lifecycle).toBeNull();
    expect(first.terminal).toBeNull();
    expect(first.usage).toBeNull();
    expect(first.finalText).toBeNull();
    expect(first.prompts).toEqual([]);
    expect(first.agentText).toEqual([]);
    expect(second).toEqual(first);
    expect(state).toEqual(snapshot);

    let prototypeRun = apply(plannedApi().initialTimelineState, {
      runId: '__proto__',
      update: { kind: 'prompt', text: 'Prototype run', messageId: 'proto' },
    });
    prototypeRun = apply(
      prototypeRun,
      runEvent('__proto__', 1, 'output', {
        kind: 'assistant_text',
        text: 'Prototype response',
      }),
    );
    expect(api.selectPromptEntries(prototypeRun, '__proto__')).toHaveLength(1);
    expect(api.selectFinalAgentText(prototypeRun, '__proto__')).toMatchObject({
      origin: 'assistant_text',
      text: 'Prototype response',
    });
  });
});
