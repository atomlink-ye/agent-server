import { describe, expect, it, vi } from 'vitest';

import * as streamReducer from './stream-reducer';
import type {
  ApprovalEntry,
  AgentTextEntry,
  LifecycleEntry,
  PromptEntry,
  ThinkingEntry,
  TimelineEntry,
  TimelineEnvelope,
  TimelineState,
  TimelineToolEntry,
  UsageEntry,
} from './stream-reducer';

function runEvent(
  runId: string,
  sequence: number,
  type: string,
  payload?: Record<string, unknown>,
  createdAt?: string | null,
): TimelineEnvelope {
  const event = {
    sequence,
    type,
    ...(payload === undefined ? {} : { payload }),
    ...(createdAt === undefined ? {} : { createdAt }),
  };
  return {
    runId,
    update: {
      kind: 'runEvent',
      event,
    },
  };
}

function apply(
  state: TimelineState,
  envelope: TimelineEnvelope,
): TimelineState {
  return streamReducer.applyTimelineEnvelope(state, envelope);
}

function malformedEnvelope(value: unknown): TimelineEnvelope {
  return value as TimelineEnvelope;
}

function entries(
  state: TimelineState,
  runId: string,
): readonly TimelineEntry[] {
  return state.runs[runId]?.entries ?? [];
}

function entryByValue(
  state: TimelineState,
  runId: string,
  value: string,
): TimelineEntry | undefined {
  return entries(state, runId).find(
    (entry) => entry.activityId.value === value,
  );
}

function entryField(
  entry: TimelineEntry | null | undefined,
  key: string,
): unknown {
  return entry && Object.hasOwn(entry, key)
    ? Reflect.get(entry, key)
    : undefined;
}

type AssistantTextEntry = Extract<
  AgentTextEntry,
  { readonly origin: 'assistant_text' }
>;

function assistantTextEntry(
  entry: TimelineEntry | null | undefined,
): AssistantTextEntry {
  expect(entry).toBeDefined();
  if (!entry || entry.kind !== 'agentText' || entry.origin !== 'assistant_text')
    throw new Error('expected an assistant text entry');
  return entry;
}

function toolEntry(entry: TimelineEntry | undefined): TimelineToolEntry {
  expect(entry).toBeDefined();
  if (!entry || entry.kind !== 'tool') throw new Error('expected a tool entry');
  return entry;
}

function thinkingEntry(
  entry: TimelineEntry | undefined,
): Extract<ThinkingEntry, { readonly origin: 'reasoning_progress' }> {
  expect(entry).toBeDefined();
  if (
    !entry ||
    entry.kind !== 'thinking' ||
    entry.origin !== 'reasoning_progress'
  )
    throw new Error('expected a reasoning entry');
  return entry;
}

function approvalEntry(entry: TimelineEntry | undefined): ApprovalEntry {
  expect(entry).toBeDefined();
  if (!entry || entry.kind !== 'approval')
    throw new Error('expected an approval entry');
  return entry;
}

function lifecycleEntry(
  entry: TimelineEntry | null | undefined,
): LifecycleEntry {
  expect(entry).toBeDefined();
  if (!entry || entry.kind !== 'lifecycle')
    throw new Error('expected a lifecycle entry');
  return entry;
}

function promptEntry(entry: TimelineEntry | undefined): PromptEntry {
  expect(entry).toBeDefined();
  if (!entry || entry.kind !== 'prompt')
    throw new Error('expected a prompt entry');
  return entry;
}

function usageEntry(entry: TimelineEntry | null | undefined): UsageEntry {
  expect(entry).toBeDefined();
  if (!entry || entry.kind !== 'usage')
    throw new Error('expected a usage entry');
  return entry;
}

function childToolEntry(
  entry: TimelineEntry | undefined,
): Extract<TimelineToolEntry, { readonly origin: 'child_timeline_item' }> {
  expect(entry).toBeDefined();
  if (!entry || entry.kind !== 'tool' || entry.origin !== 'child_timeline_item')
    throw new Error('expected a child tool entry');
  return entry;
}

function childAgentTextEntry(
  entry: TimelineEntry | undefined,
): Extract<AgentTextEntry, { readonly origin: 'child_timeline_item' }> {
  expect(entry).toBeDefined();
  if (
    !entry ||
    entry.kind !== 'agentText' ||
    entry.origin !== 'child_timeline_item'
  )
    throw new Error('expected a child agent text entry');
  return entry;
}

function childThinkingEntry(
  entry: TimelineEntry | undefined,
): Extract<ThinkingEntry, { readonly origin: 'child_timeline_item' }> {
  expect(entry).toBeDefined();
  if (
    !entry ||
    entry.kind !== 'thinking' ||
    entry.origin !== 'child_timeline_item'
  )
    throw new Error('expected a child thinking entry');
  return entry;
}

function toolStatusEntry(
  entry: TimelineEntry | undefined,
): Extract<TimelineToolEntry, { readonly origin: 'tool_status' }> {
  expect(entry).toBeDefined();
  if (!entry || entry.kind !== 'tool' || entry.origin !== 'tool_status')
    throw new Error('expected a top-level tool entry');
  return entry;
}

describe('planned ordered timeline reducer (S5 Task 2 red tests)', () => {
  it('keeps one agent text entry across seq26 then thinking27/28 then seq29', () => {
    const api = streamReducer;
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
    expect(assistantTextEntry(textEntries[0])).toMatchObject({
      text: 'before thinking seq29',
    });
  });

  it('isolates the same wire activity identity across runs', () => {
    const api = streamReducer;
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
    expect(toolEntry(a[0])).toMatchObject({
      runId: 'run-a',
      activityId: { scope: 'wire', value: 'activity-1' },
    });
    expect(toolEntry(b[0])).toMatchObject({
      runId: 'run-b',
      activityId: { scope: 'wire', value: 'activity-1' },
    });
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
  });

  it('rejects cross-kind wire identity collisions and bounds diagnostics', () => {
    const api = streamReducer;
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

  it('handles cumulative assistant text and diagnoses non-prefix snapshots', () => {
    const api = streamReducer;
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
    expect(assistantTextEntry(entries(state, 'run-a')[0])).toMatchObject({
      kind: 'agentText',
      firstSequence: 1,
      lastSequence: 3,
      text: 'Hello world',
    });
    expect(state.diagnostics).toEqual([
      {
        code: 'assistant_text_non_prefix',
        runId: 'run-a',
        activityId: { scope: 'local', value: 'agent-text:1' },
        sequence: 4,
      },
    ]);
    expect(
      state.diagnostics.every(
        (diagnostic) =>
          Object.keys(diagnostic).sort().join(',') ===
          'activityId,code,runId,sequence',
      ),
    ).toBe(true);
    expect(JSON.stringify(state.diagnostics)).not.toContain('Not a prefix');
  });

  it('keeps one open agent segment across a same top-level tool completion', () => {
    const api = streamReducer;
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
        text: 'A',
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
    state = apply(
      state,
      runEvent('run-a', 4, 'output', {
        kind: 'assistant_text',
        text: 'AB',
      }),
    );
    expect(entries(state, 'run-a')).toHaveLength(2);
    const text = assistantTextEntry(
      entryByValue(state, 'run-a', 'agent-text:2'),
    );
    expect(text).toMatchObject({
      firstSequence: 2,
      lastSequence: 4,
      text: 'AB',
      status: 'streaming',
    });
    expect(toolEntry(entryByValue(state, 'run-a', 'tool-1'))).toMatchObject({
      status: 'completed',
      firstSequence: 1,
      lastSequence: 3,
    });
    expect(state.runs['run-a']?.openAgentTextActivityId).toEqual(
      text.activityId,
    );
  });

  it('closes an open agent segment when a new top-level tool is created', () => {
    const api = streamReducer;
    let state = apply(
      api.initialTimelineState,
      runEvent('run-a', 1, 'output', {
        kind: 'assistant_text',
        text: 'A',
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
    const agent = assistantTextEntry(
      entryByValue(state, 'run-a', 'agent-text:1'),
    );
    expect(agent).toMatchObject({
      firstSequence: 1,
      lastSequence: 1,
      text: 'A',
      status: 'streaming',
    });
    expect(state.runs['run-a']?.openAgentTextActivityId).toBeNull();
  });

  it('keeps thinking, approval, usage, lifecycle, child, and existing-tool updates in one agent entry', () => {
    const api = streamReducer;
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
    expect(
      assistantTextEntry(entryByValue(state, 'run-a', 'agent-text:2')),
    ).toMatchObject({
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
    const api = streamReducer;
    let missing = apply(
      api.initialTimelineState,
      runEvent('missing', 1, 'output', {
        kind: 'reasoning_progress',
        status: 'completed',
        text: 'done',
      }),
    );
    expect(thinkingEntry(entries(missing, 'missing')[0])).toMatchObject({
      activityId: { scope: 'local', value: 'thinking:1' },
      firstSequence: 1,
      lastSequence: 1,
    });
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
    expect(thinkingEntry(entries(state, 'run-a')[0])).toMatchObject({
      kind: 'thinking',
      firstSequence: 1,
      lastSequence: 3,
      text: 'ABC',
    });
    expect(thinkingEntry(entries(state, 'run-a')[1])).toMatchObject({
      kind: 'thinking',
      firstSequence: 4,
      lastSequence: 4,
      text: 'new',
    });
  });

  it('guards monotonic tool and approval statuses', () => {
    const api = streamReducer;
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
    const toolDiagnostics = structuredClone(state.diagnostics);
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
    expect(state.diagnostics).toEqual(toolDiagnostics);
    expect(state.runs['run-a']?.lastSequence).toBe(4);
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
    const approvalDiagnostics = structuredClone(state.diagnostics);
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
    expect(state.diagnostics).toEqual(approvalDiagnostics);
    expect(state.runs['run-a']?.lastSequence).toBe(7);
  });

  it('maps child item kinds while preserving wire identity and never closing top-level agent text', () => {
    const api = streamReducer;
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
    expect(
      childAgentTextEntry(entryByValue(state, 'run-a', 'child-a')),
    ).toMatchObject({
      activityId: { scope: 'wire', value: 'child-a' },
      parentActivityId: { scope: 'wire', value: 'parent' },
    });
    expect(
      childThinkingEntry(entryByValue(state, 'run-a', 'child-r')),
    ).toMatchObject({
      activityId: { scope: 'wire', value: 'child-r' },
      parentActivityId: { scope: 'wire', value: 'parent' },
    });
    expect(
      childToolEntry(entryByValue(state, 'run-a', 'child-t')),
    ).toMatchObject({
      activityId: { scope: 'wire', value: 'child-t' },
      parentActivityId: { scope: 'wire', value: 'parent' },
      detailText: 'tool-detail',
    });
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
    expect(
      childToolEntry(
        entryByValue(childThenParent, 'child-first', 'orphan-child'),
      ),
    ).toMatchObject({
      activityId: { scope: 'wire', value: 'orphan-child' },
      parentActivityId: { scope: 'wire', value: 'late-parent' },
    });
  });

  it('ignores late run events after terminal while canonical text can save the last agent segment', () => {
    const api = streamReducer;
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
    expect(
      assistantTextEntry(entryByValue(state, 'run-a', 'agent-text:1')),
    ).toMatchObject({
      text: 'saved',
      status: 'saved',
      messageId: 'assistant-1',
    });
    const canonicalOnly = apply(api.initialTimelineState, {
      runId: 'run-b',
      update: {
        kind: 'canonicalAgentText',
        text: 'saved',
        messageId: 'assistant-2',
      },
    });
    expect(
      assistantTextEntry(
        entryByValue(canonicalOnly, 'run-b', 'agent-text:canonical'),
      ),
    ).toMatchObject({
      activityId: { scope: 'local', value: 'agent-text:canonical' },
      status: 'saved',
      messageId: 'assistant-2',
    });
  });

  it('canonicalizes only the last top-level agent segment for a reused message id', () => {
    const api = streamReducer;
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
    expect(
      assistantTextEntry(entryByValue(state, 'run-a', 'agent-text:3')),
    ).toMatchObject({
      kind: 'agentText',
      text: 'segment B saved',
      status: 'saved',
      messageId: 'same-message',
    });
  });

  it('allows same-terminal updates to fill tool, child-tool, and approval details', () => {
    const api = streamReducer;
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
    expect(toolEntry(entries(toolState, 'tool-run')[0])).toMatchObject({
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
    expect(childToolEntry(entries(childState, 'child-run')[0])).toMatchObject({
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
    expect(
      approvalEntry(entries(approvalState, 'approval-run')[0]),
    ).toMatchObject({
      kind: 'approval',
      status: 'resolved',
      decision: 'allowed',
    });
    expect(entries(approvalState, 'approval-run')).toEqual(resolvedApproval);
  });

  it('keeps consecutive reasoning completions separate before a new span', () => {
    const api = streamReducer;
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
    expect(entries(state, 'reasoning-run')).toHaveLength(3);
    expect(thinkingEntry(entries(state, 'reasoning-run')[0])).toMatchObject({
      kind: 'thinking',
      activityId: { scope: 'local', value: 'thinking:1' },
      firstSequence: 1,
      lastSequence: 1,
      status: 'completed',
      text: 'first completed',
    });
    expect(thinkingEntry(entries(state, 'reasoning-run')[1])).toMatchObject({
      kind: 'thinking',
      activityId: { scope: 'local', value: 'thinking:2' },
      firstSequence: 2,
      lastSequence: 2,
      status: 'completed',
      text: 'second completed',
    });
    expect(thinkingEntry(entries(state, 'reasoning-run')[2])).toMatchObject({
      kind: 'thinking',
      activityId: { scope: 'local', value: 'thinking:3' },
      firstSequence: 3,
      lastSequence: 3,
      status: 'started',
      text: 'new span',
    });
  });

  it('treats prototype-looking run ids as independent own runs', () => {
    const api = streamReducer;
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
      expect(assistantTextEntry(entries(state, runId)[0])).toMatchObject({
        runId,
        text: `text for ${runId}`,
      });
    }
  });

  it('advances only the addressed run sequence for unknown or malformed outputs', () => {
    const api = streamReducer;
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
      malformedEnvelope({
        runId: 'run-a',
        update: {
          kind: 'runEvent',
          event: { sequence: 'not-a-sequence', type: 'output' },
        },
      }),
    );
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
    const api = streamReducer;
    const prompt: TimelineEnvelope = {
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
    expect(promptEntry(entries(state, 'run-a')[0])).toMatchObject({
      kind: 'prompt',
      firstSequence: null,
      lastSequence: null,
      messageId: 'message-1',
    });
  });

  it('merges usage fields while preserving first and advancing last sequence', () => {
    const api = streamReducer;
    let state = apply(
      api.initialTimelineState,
      runEvent('usage-run', 1, 'output', {
        kind: 'usage',
        input_tokens: 10,
        output_tokens: 3,
        total_cost_usd: 0.42,
      }),
    );
    state = apply(
      state,
      runEvent('usage-run', 2, 'output', {
        kind: 'usage',
        input_tokens: 11,
      }),
    );
    const usage = entries(state, 'usage-run').find(
      (entry) => entry.kind === 'usage',
    );
    expect(usage).toEqual({
      kind: 'usage',
      runId: 'usage-run',
      activityId: { scope: 'local', value: 'usage' },
      firstSequence: 1,
      lastSequence: 2,
      firstCreatedAt: null,
      lastCreatedAt: null,
      usage: { inputTokens: 11, outputTokens: 3, totalCostUsd: 0.42 },
    });
  });

  it('keeps apply pure for initial state, input state, and entries arrays', () => {
    const api = streamReducer;
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

function selectorFixture(runId = 'selector-run'): TimelineState {
  const api = streamReducer;
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
    const entries = streamReducer.selectActivityEntries(state, 'selector-run');

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
    expect(entries.map((entry) => entry.kind)).not.toContain('prompt');
    expect(
      entries.map((entry) => ('origin' in entry ? entry.origin : null)),
    ).not.toContain('child_timeline_item');
    expect(usageEntry(entries[3])).toMatchObject({
      kind: 'usage',
      firstSequence: 9,
      lastSequence: 14,
      usage: { inputTokens: 10, outputTokens: 3, totalCostUsd: 0.42 },
    });
  });

  it('groups children by raw parent id without mixing top-level entries', () => {
    const state = selectorFixture();
    const children = streamReducer.selectChildEntriesByParent(
      state,
      'selector-run',
    );

    expect(children).toBeInstanceOf(Map);
    expect([...children.keys()]).toEqual(['__proto__']);
    const childEntries = children.get('__proto__') ?? [];
    expect(childEntries).toHaveLength(3);
    expect(
      childToolEntry(
        childEntries.find((entry) => entry.activityId.value === 'child-tool'),
      ),
    ).toMatchObject({
      activityId: { scope: 'wire', value: 'child-tool' },
      parentActivityId: { scope: 'wire', value: '__proto__' },
      firstSequence: 3,
    });
    expect(
      childAgentTextEntry(
        childEntries.find(
          (entry) => entry.activityId.value === 'child-assistant',
        ),
      ),
    ).toMatchObject({
      activityId: { scope: 'wire', value: 'child-assistant' },
      parentActivityId: { scope: 'wire', value: '__proto__' },
      firstSequence: 6,
    });
    expect(
      childThinkingEntry(
        childEntries.find(
          (entry) => entry.activityId.value === 'child-reasoning',
        ),
      ),
    ).toMatchObject({
      activityId: { scope: 'wire', value: 'child-reasoning' },
      parentActivityId: { scope: 'wire', value: '__proto__' },
      firstSequence: 7,
    });
    expect(
      [...children.values()]
        .flat()
        .every((entry) =>
          'origin' in entry ? entry.origin === 'child_timeline_item' : false,
        ),
    ).toBe(true);
  });

  it('groups parent-linked legacy tool entries as children even before their parent', () => {
    const api = streamReducer;
    let state = apply(
      streamReducer.initialTimelineState,
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

    const activity = api.selectActivityEntries(state, 'legacy-child-run');
    expect(activity).toHaveLength(1);
    expect(toolStatusEntry(activity[0])).toMatchObject({
      activityId: { scope: 'wire', value: 'parent' },
      firstSequence: 2,
    });
    const legacyChildren =
      api.selectChildEntriesByParent(state, 'legacy-child-run').get('parent') ??
      [];
    expect(legacyChildren).toHaveLength(2);
    expect(
      toolStatusEntry(
        legacyChildren.find(
          (entry) => entry.activityId.value === 'legacy-child',
        ),
      ),
    ).toMatchObject({
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
    });
    expect(
      childAgentTextEntry(
        legacyChildren.find(
          (entry) => entry.activityId.value === 'timeline-child',
        ),
      ),
    ).toMatchObject({
      activityId: { scope: 'wire', value: 'timeline-child' },
      parentActivityId: { scope: 'wire', value: 'parent' },
      firstSequence: 3,
    });
  });

  it('selects the last lifecycle and only a terminal lifecycle when present', () => {
    const api = streamReducer;
    const state = selectorFixture();
    expect(
      lifecycleEntry(api.selectCurrentLifecycle(state, 'selector-run')),
    ).toMatchObject({
      kind: 'lifecycle',
      status: 'succeeded',
      firstSequence: 15,
      lastSequence: 15,
    });
    expect(
      lifecycleEntry(api.selectTerminalLifecycle(state, 'selector-run')),
    ).toMatchObject({
      kind: 'lifecycle',
      status: 'succeeded',
    });

    const startedOnly = apply(
      streamReducer.initialTimelineState,
      runEvent('started-only', 1, 'started'),
    );
    expect(
      lifecycleEntry(api.selectCurrentLifecycle(startedOnly, 'started-only')),
    ).toMatchObject({ status: 'started' });
    expect(api.selectTerminalLifecycle(startedOnly, 'started-only')).toBeNull();
    expect(api.selectCurrentLifecycle(state, 'missing-run')).toBeNull();
    expect(api.selectTerminalLifecycle(state, 'missing-run')).toBeNull();
  });

  it('returns the merged usage entry while preserving its first sequence', () => {
    const state = selectorFixture();
    expect(
      usageEntry(streamReducer.selectUsageEntry(state, 'selector-run')),
    ).toMatchObject({
      kind: 'usage',
      activityId: { scope: 'local', value: 'usage' },
      firstSequence: 9,
      lastSequence: 14,
      usage: { inputTokens: 10, outputTokens: 3, totalCostUsd: 0.42 },
    });
    expect(streamReducer.selectUsageEntry(state, 'missing-run')).toBeNull();
  });

  it('selects only top-level agent text and keeps prompt order stable', () => {
    const api = streamReducer;
    const state = selectorFixture();
    expect(
      assistantTextEntry(api.selectFinalAgentText(state, 'selector-run')),
    ).toMatchObject({
      kind: 'agentText',
      origin: 'assistant_text',
      activityId: { scope: 'local', value: 'agent-text:12' },
      text: 'Agent B',
      firstSequence: 12,
      lastSequence: 12,
    });
    const agentTextEntries = api.selectAgentTextEntries(state, 'selector-run');
    expect(agentTextEntries).toHaveLength(2);
    expect(assistantTextEntry(agentTextEntries[0])).toMatchObject({
      activityId: { scope: 'local', value: 'agent-text:5' },
      text: 'Agent A extended',
      firstSequence: 5,
      lastSequence: 10,
    });
    expect(assistantTextEntry(agentTextEntries[1])).toMatchObject({
      activityId: { scope: 'local', value: 'agent-text:12' },
      text: 'Agent B',
    });
    expect(
      api
        .selectAgentTextEntries(state, 'selector-run')
        .every(
          (entry) =>
            entry.kind === 'agentText' && entry.origin === 'assistant_text',
        ),
    ).toBe(true);
    const promptEntries = api.selectPromptEntries(state, 'selector-run');
    expect(promptEntries).toHaveLength(1);
    expect(promptEntry(promptEntries[0])).toMatchObject({
      text: 'Inspect the repository',
      messageId: 'p1',
      firstSequence: null,
      lastSequence: null,
    });
  });

  it('returns empty or null values for missing runs and remains pure across calls', () => {
    const api = streamReducer;
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

    let prototypeRun = apply(streamReducer.initialTimelineState, {
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
    expect(
      assistantTextEntry(api.selectFinalAgentText(prototypeRun, '__proto__')),
    ).toMatchObject({
      origin: 'assistant_text',
      text: 'Prototype response',
    });
  });
});

describe('created_at provenance and provider red tests', () => {
  it('records created_at first/last values and provider across entry variants', () => {
    const api = streamReducer;
    let state = apply(
      api.initialTimelineState,
      runEvent(
        'provenance-run',
        1,
        'output',
        {
          kind: 'assistant_text',
          text: 'A',
        },
        '2026-08-08T10:00:00.001Z',
      ),
    );
    state = apply(
      state,
      runEvent(
        'provenance-run',
        2,
        'output',
        {
          kind: 'assistant_text',
          text: 'AB',
        },
        '2026-08-08T10:00:00.002Z',
      ),
    );
    const text = assistantTextEntry(
      entryByValue(state, 'provenance-run', 'agent-text:1'),
    );
    expect(text.firstCreatedAt).toBe('2026-08-08T10:00:00.001Z');
    expect(text.lastCreatedAt).toBe('2026-08-08T10:00:00.002Z');

    state = apply(
      state,
      runEvent(
        'provenance-run',
        3,
        'output',
        {
          kind: 'tool_status',
          activity_id: 'tool-provenance',
          category: 'shell',
          status: 'running',
          label: 'Shell',
          summary: 'running',
          provider: 'opencode',
        },
        '2026-08-08T10:00:00.003Z',
      ),
    );
    state = apply(
      state,
      runEvent(
        'provenance-run',
        4,
        'output',
        {
          kind: 'tool_status',
          activity_id: 'tool-provenance',
          category: 'shell',
          status: 'completed',
          label: 'Shell',
          summary: 'completed',
          provider: 'opencode',
        },
        '2026-08-08T10:00:00.004Z',
      ),
    );
    const tool = toolEntry(
      entryByValue(state, 'provenance-run', 'tool-provenance'),
    );
    expect(tool.firstCreatedAt).toBe('2026-08-08T10:00:00.003Z');
    expect(tool.lastCreatedAt).toBe('2026-08-08T10:00:00.004Z');
    expect(tool.provider).toBe('opencode');

    state = apply(
      state,
      runEvent(
        'provenance-run',
        5,
        'output',
        {
          kind: 'child_timeline_item',
          activity_id: 'child-provenance',
          parent_activity_id: 'tool-provenance',
          item_kind: 'tool',
          status: 'running',
          label: 'Child shell',
          summary: 'running',
          provider: 'codex',
        },
        '2026-08-08T10:00:00.005Z',
      ),
    );
    const child = childToolEntry(
      entryByValue(state, 'provenance-run', 'child-provenance'),
    );
    expect(child.firstCreatedAt).toBe('2026-08-08T10:00:00.005Z');
    expect(child.lastCreatedAt).toBe('2026-08-08T10:00:00.005Z');
    expect(child.provider).toBe('codex');
  });

  it('preserves the existing last_created_at when an update has no valid timestamp', () => {
    let state = apply(
      streamReducer.initialTimelineState,
      runEvent(
        'provenance-preserve-run',
        1,
        'output',
        {
          kind: 'tool_status',
          activity_id: 'tool-preserve-time',
          category: 'shell',
          status: 'running',
          label: 'Shell',
          summary: 'running',
        },
        '2026-08-08T10:00:00.001Z',
      ),
    );
    state = apply(
      state,
      runEvent(
        'provenance-preserve-run',
        2,
        'output',
        {
          kind: 'tool_status',
          activity_id: 'tool-preserve-time',
          category: 'shell',
          status: 'completed',
          label: 'Shell',
          summary: 'completed',
        },
        null,
      ),
    );

    expect(
      toolEntry(
        entryByValue(state, 'provenance-preserve-run', 'tool-preserve-time'),
      ).lastCreatedAt,
    ).toBe('2026-08-08T10:00:00.001Z');
  });

  it('does not read a payload created_at value as event provenance', () => {
    const state = apply(
      streamReducer.initialTimelineState,
      runEvent('payload-time-run', 1, 'output', {
        kind: 'assistant_text',
        text: 'A',
        created_at: '2026-08-08T10:00:00.999Z',
      }),
    );
    const text = assistantTextEntry(
      entryByValue(state, 'payload-time-run', 'agent-text:1'),
    );
    expect(text.firstCreatedAt).toBeNull();
    expect(text.lastCreatedAt).toBeNull();
  });

  it('uses null provenance for missing or invalid created_at without reading Date.now', () => {
    const now = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('apply must not read the client clock');
    });
    try {
      const api = streamReducer;
      let state = apply(
        api.initialTimelineState,
        runEvent('provenance-null-run', 1, 'output', {
          kind: 'assistant_text',
          text: 'A',
        }),
      );
      state = apply(
        state,
        runEvent(
          'provenance-null-run',
          2,
          'output',
          {
            kind: 'tool_status',
            activity_id: 'tool-invalid-time',
            category: 'shell',
            status: 'running',
            label: 'Shell',
            summary: 'running',
          },
          '0',
        ),
      );
      state = apply(
        state,
        runEvent(
          'provenance-null-run',
          3,
          'output',
          {
            kind: 'tool_status',
            activity_id: 'tool-invalid-time',
            category: 'shell',
            status: 'completed',
            label: 'Shell',
            summary: 'completed',
          },
          '2026-02-30T00:00:00Z',
        ),
      );
      state = apply(
        state,
        malformedEnvelope({
          runId: 'provenance-null-run',
          update: {
            kind: 'runEvent',
            event: {
              sequence: 4,
              type: 'output',
              payload: {
                kind: 'child_timeline_item',
                activity_id: 'child-invalid-time',
                parent_activity_id: 'tool-invalid-time',
                item_kind: 'tool',
                status: 'running',
                label: 'Child shell',
                summary: 'running',
              },
              createdAt: 42,
            },
          },
        }),
      );

      const text = assistantTextEntry(
        entryByValue(state, 'provenance-null-run', 'agent-text:1'),
      );
      const tool = toolEntry(
        entryByValue(state, 'provenance-null-run', 'tool-invalid-time'),
      );
      const child = childToolEntry(
        entryByValue(state, 'provenance-null-run', 'child-invalid-time'),
      );
      expect(text.firstCreatedAt).toBeNull();
      expect(text.lastCreatedAt).toBeNull();
      expect(tool.firstCreatedAt).toBeNull();
      expect(tool.lastCreatedAt).toBeNull();
      expect(child.firstCreatedAt).toBeNull();
      expect(child.lastCreatedAt).toBeNull();
    } finally {
      now.mockRestore();
    }
  });
});
