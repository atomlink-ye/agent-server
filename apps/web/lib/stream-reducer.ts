export type LifecycleEvent = 'started' | 'succeeded' | 'failed' | 'cancelled';
export type ReasoningStatus = 'started' | 'completed';
export type ToolCategory =
  | 'shell'
  | 'read'
  | 'edit'
  | 'write'
  | 'search'
  | 'fetch'
  | 'subagent'
  | 'other';
export type ToolStatus = 'running' | 'completed' | 'failed' | 'cancelled';
export type PermissionCategory =
  'tool' | 'plan' | 'question' | 'mode' | 'other';
export type PermissionStatus = 'requested' | 'resolved';
export type PermissionDecision = 'allowed' | 'denied';

export type RunStreamEvent = {
  readonly sequence: number;
  readonly type: string;
  readonly payload?: unknown;
};

type ParsedTool = {
  readonly activityId: string;
  readonly category: ToolCategory;
  readonly status: ToolStatus;
  readonly label: string;
  readonly summary: string;
  readonly toolName?: string;
  readonly parentActivityId?: string;
  readonly detailKind?: DetailKind;
  readonly detailText?: string;
  readonly exitCode?: number;
};

export type DetailKind =
  'shell' | 'read' | 'write' | 'edit' | 'search' | 'fetch';

type ParsedChild = {
  readonly activityId: string;
  readonly kind: 'assistant' | 'reasoning' | 'tool';
  readonly status: ToolStatus;
  readonly label: string;
  readonly summary: string;
  readonly detailKind?: DetailKind;
  readonly detailText?: string;
  readonly exitCode?: number;
};

type ParsedPermission = {
  readonly activityId: string;
  readonly category: PermissionCategory;
  readonly status: PermissionStatus;
  readonly decision?: PermissionDecision;
  readonly summary: string;
};

export type UsageMetrics = {
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly outputTokens?: number;
  readonly totalCostUsd?: number;
  readonly contextWindowMaxTokens?: number;
  readonly contextWindowUsedTokens?: number;
};

export function parseRunStreamEvent(data: string): RunStreamEvent | null {
  try {
    const value: unknown = JSON.parse(data);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return null;
    const record = value as Record<string, unknown>;
    if (
      typeof record.sequence !== 'number' ||
      !Number.isSafeInteger(record.sequence) ||
      record.sequence < 1 ||
      typeof record.type !== 'string'
    )
      return null;
    return {
      sequence: record.sequence,
      type: record.type,
      ...(Object.hasOwn(record, 'payload') ? { payload: record.payload } : {}),
    };
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isReasoningStatus(value: unknown): value is ReasoningStatus {
  return value === 'started' || value === 'completed';
}

export const FALLBACK_TOOL_LABELS: Record<ToolCategory, string> = {
  shell: 'Shell activity',
  read: 'Read activity',
  edit: 'Edit activity',
  write: 'Write activity',
  search: 'Workspace search',
  fetch: 'Fetch activity',
  subagent: 'Sub-agent task',
  other: 'Tool activity',
};

function parseTool(value: Record<string, unknown>): ParsedTool | null {
  const activityId = boundedString(value.activity_id, 256);
  if (
    !activityId ||
    !isToolCategory(value.category) ||
    !isToolStatus(value.status)
  )
    return null;
  const rawLabel = value.label;
  let label: string;
  if (rawLabel === undefined) {
    label = FALLBACK_TOOL_LABELS[value.category as ToolCategory];
  } else {
    const parsed = boundedString(rawLabel, 120);
    if (!parsed) return null;
    label = parsed;
  }
  const summary = boundedString(value.summary, 2000);
  if (!summary) return null;
  const parentActivityId =
    value.parent_activity_id === undefined
      ? undefined
      : boundedString(value.parent_activity_id, 256);
  if (value.parent_activity_id !== undefined && !parentActivityId) return null;
  return {
    activityId,
    category: value.category as ToolCategory,
    status: value.status as ToolStatus,
    label,
    summary,
    ...(boundedString(value.tool_name, 120)
      ? { toolName: boundedString(value.tool_name, 120)! }
      : {}),
    ...(parentActivityId ? { parentActivityId } : {}),
    ...parseDetailFields(value),
  };
}

function parseChild(value: Record<string, unknown>):
  | (ParsedChild & {
      readonly parentActivityId: string;
    })
  | null {
  const activityId = boundedString(value.activity_id, 256);
  const parentActivityId = boundedString(value.parent_activity_id, 256);
  const label = boundedString(value.label, 120);
  const summary = boundedString(value.summary, 2000);
  if (
    !activityId ||
    !parentActivityId ||
    !label ||
    !summary ||
    !isChildKind(value.item_kind) ||
    !isToolStatus(value.status)
  )
    return null;
  return {
    activityId,
    parentActivityId,
    kind: value.item_kind,
    status: value.status,
    label,
    summary,
    ...parseDetailFields(value),
  };
}

function parseDetailFields(value: Record<string, unknown>): {
  readonly detailKind?: DetailKind;
  readonly detailText?: string;
  readonly exitCode?: number;
} {
  const detailKind = isDetailKind(value.detail_kind)
    ? value.detail_kind
    : undefined;
  const detailText =
    value.detail_text === undefined
      ? undefined
      : (boundedString(value.detail_text, 12000) ?? undefined);
  const exitCode =
    typeof value.exit_code === 'number' && Number.isInteger(value.exit_code)
      ? value.exit_code
      : undefined;
  return {
    ...(detailKind ? { detailKind } : {}),
    ...(detailText ? { detailText } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
  };
}

function boundedString(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength
    ? value
    : null;
}

function parsePermission(
  value: Record<string, unknown>,
): ParsedPermission | null {
  if (
    typeof value.activity_id !== 'string' ||
    !isPermissionCategory(value.category) ||
    !isPermissionStatus(value.status) ||
    typeof value.summary !== 'string'
  )
    return null;
  return {
    activityId: value.activity_id,
    category: value.category,
    status: value.status,
    ...(isPermissionDecision(value.decision)
      ? { decision: value.decision }
      : {}),
    summary: value.summary,
  };
}

function parseUsage(value: Record<string, unknown>): UsageMetrics | null {
  const keys = [
    ['input_tokens', 'inputTokens'],
    ['cached_input_tokens', 'cachedInputTokens'],
    ['output_tokens', 'outputTokens'],
    ['total_cost_usd', 'totalCostUsd'],
    ['context_window_max_tokens', 'contextWindowMaxTokens'],
    ['context_window_used_tokens', 'contextWindowUsedTokens'],
  ] as const;
  const usage: Record<string, number> = {};
  let found = false;
  for (const [wireKey, key] of keys) {
    const valueAtKey = value[wireKey];
    if (valueAtKey === undefined) continue;
    if (
      typeof valueAtKey !== 'number' ||
      !Number.isFinite(valueAtKey) ||
      valueAtKey < 0
    )
      return null;
    usage[key] = valueAtKey;
    found = true;
  }
  return found ? usage : null;
}

function canAdvanceTool(previous: ToolStatus, next: ToolStatus): boolean {
  if (previous === next) return true;
  if (previous !== 'running') return false;
  return next !== 'running';
}

function canAdvancePermission(
  previous: PermissionStatus,
  next: PermissionStatus,
): boolean {
  return previous === next || (previous === 'requested' && next === 'resolved');
}

function isToolCategory(value: unknown): value is ToolCategory {
  return [
    'shell',
    'read',
    'edit',
    'write',
    'search',
    'fetch',
    'subagent',
    'other',
  ].includes(String(value));
}

function isToolStatus(value: unknown): value is ToolStatus {
  return ['running', 'completed', 'failed', 'cancelled'].includes(
    String(value),
  );
}

function isChildKind(value: unknown): value is ParsedChild['kind'] {
  return value === 'assistant' || value === 'reasoning' || value === 'tool';
}

function isDetailKind(value: unknown): value is DetailKind {
  return ['shell', 'read', 'write', 'edit', 'search', 'fetch'].includes(
    String(value),
  );
}

function isPermissionCategory(value: unknown): value is PermissionCategory {
  return ['tool', 'plan', 'question', 'mode', 'other'].includes(String(value));
}

function isPermissionStatus(value: unknown): value is PermissionStatus {
  return value === 'requested' || value === 'resolved';
}

function isPermissionDecision(value: unknown): value is PermissionDecision {
  return value === 'allowed' || value === 'denied';
}

/*
 * Ordered timeline model backed by the wire parsers above. The model
 * normalizes stream events into stable entries for page consumers.
 */
export type TimelineActivityId = Readonly<{
  readonly scope: 'wire' | 'local';
  readonly value: string;
}>;

export type TimelineEntryIdentity = Readonly<{
  readonly runId: string;
  readonly activityId: TimelineActivityId;
}>;

type TimelineEntryBase = TimelineEntryIdentity &
  Readonly<{ firstSequence: number | null; lastSequence: number | null }>;

export type PromptEntry = TimelineEntryBase & {
  readonly kind: 'prompt';
  readonly text: string;
  readonly messageId?: string;
};

export type AgentTextEntry = TimelineEntryBase &
  (
    | {
        readonly kind: 'agentText';
        readonly origin: 'assistant_text';
        readonly text: string;
        readonly status: 'streaming' | 'saved';
        readonly messageId?: string;
      }
    | {
        readonly kind: 'agentText';
        readonly origin: 'child_timeline_item';
        readonly parentActivityId: TimelineActivityId;
        readonly status: ToolStatus;
        readonly label: string;
        readonly summary: string;
        readonly detailKind?: DetailKind;
        readonly detailText?: string;
        readonly exitCode?: number;
      }
  );

export type ThinkingEntry = TimelineEntryBase &
  (
    | {
        readonly kind: 'thinking';
        readonly origin: 'reasoning_progress';
        readonly status: ReasoningStatus;
        readonly text?: string;
      }
    | {
        readonly kind: 'thinking';
        readonly origin: 'child_timeline_item';
        readonly parentActivityId: TimelineActivityId;
        readonly status: ToolStatus;
        readonly label: string;
        readonly summary: string;
        readonly detailKind?: DetailKind;
        readonly detailText?: string;
        readonly exitCode?: number;
      }
  );

export type TimelineToolEntry = TimelineEntryBase &
  Readonly<{
    kind: 'tool';
    status: ToolStatus;
    sourceActivityId: string;
    label: string;
    summary: string;
    toolName?: string;
    detailKind?: DetailKind;
    detailText?: string;
    exitCode?: number;
  }> &
  (
    | {
        readonly origin: 'tool_status';
        readonly category: ToolCategory;
        readonly parentActivityId?: TimelineActivityId;
      }
    | {
        readonly origin: 'child_timeline_item';
        readonly parentActivityId: TimelineActivityId;
      }
  );

/** Public contract name retained for consumers of the ordered model. */
export type ToolEntry = TimelineToolEntry;

/** A tool_status entry without a parent activity (top-level activity). */
export type TopLevelTimelineToolEntry = Extract<
  TimelineToolEntry,
  { readonly origin: 'tool_status' }
> &
  Readonly<{ readonly parentActivityId?: never }>;

/** A tool_status entry linked to a parent activity (child activity). */
export type ParentLinkedTimelineToolEntry = Extract<
  TimelineToolEntry,
  { readonly origin: 'tool_status' }
> &
  Readonly<{ readonly parentActivityId: TimelineActivityId }>;

export type ApprovalEntry = TimelineEntryBase & {
  readonly kind: 'approval';
  readonly sourceActivityId: string;
  readonly category: PermissionCategory;
  readonly status: PermissionStatus;
  readonly decision?: PermissionDecision;
  readonly summary: string;
};

export type UsageEntry = TimelineEntryBase & {
  readonly kind: 'usage';
  readonly usage: UsageMetrics;
};

export type LifecycleEntry = TimelineEntryBase & {
  readonly kind: 'lifecycle';
  readonly status: LifecycleEvent;
};

export type TimelineEntry =
  | PromptEntry
  | AgentTextEntry
  | ThinkingEntry
  | TimelineToolEntry
  | ApprovalEntry
  | UsageEntry
  | LifecycleEntry;

export type RunTimeline = Readonly<{
  readonly lastSequence: number;
  readonly openAgentTextActivityId: TimelineActivityId | null;
  readonly entries: readonly TimelineEntry[];
}>;

export type TimelineDiagnostic = Readonly<{
  readonly code: 'identity_kind_conflict';
  readonly runId: string;
  readonly activityId: TimelineActivityId;
  readonly sequence: number | null;
}>;

export type TimelineState = Readonly<{
  readonly runs: Readonly<Record<string, RunTimeline>>;
  readonly diagnostics: readonly TimelineDiagnostic[];
}>;

export type TimelineEnvelope =
  | Readonly<{
      readonly runId: string;
      readonly update: Readonly<{
        readonly kind: 'runEvent';
        readonly event: RunStreamEvent;
      }>;
    }>
  | Readonly<{
      readonly runId: string;
      readonly update: Readonly<{
        readonly kind: 'prompt';
        readonly text: string;
        readonly messageId?: string;
      }>;
    }>
  | Readonly<{
      readonly runId: string;
      readonly update: Readonly<{
        readonly kind: 'canonicalAgentText';
        readonly text: string;
        readonly messageId?: string;
      }>;
    }>;

export const initialTimelineState: TimelineState = {
  runs: {},
  diagnostics: [],
};

const timelineId = (
  scope: 'wire' | 'local',
  value: string,
): TimelineActivityId => ({
  scope,
  value,
});

function sameTimelineId(
  left: TimelineActivityId,
  right: TimelineActivityId,
): boolean {
  return left.scope === right.scope && left.value === right.value;
}

function timelineTerminal(run: RunTimeline): boolean {
  return run.entries.some(
    (entry) =>
      entry.kind === 'lifecycle' &&
      (entry.status === 'succeeded' ||
        entry.status === 'failed' ||
        entry.status === 'cancelled'),
  );
}

function timelineRun(): RunTimeline {
  return { lastSequence: 0, openAgentTextActivityId: null, entries: [] };
}

function timelineRunFor(state: TimelineState, runId: string): RunTimeline {
  return Object.hasOwn(state.runs, runId) ? state.runs[runId]! : timelineRun();
}

function timelineEntryIndex(
  run: RunTimeline,
  activityId: TimelineActivityId,
): number {
  return run.entries.findIndex((entry) =>
    sameTimelineId(entry.activityId, activityId),
  );
}

function sameTimelineEntryKind(
  existing: TimelineEntry,
  incoming: TimelineEntry,
): boolean {
  if (existing.kind !== incoming.kind) return false;
  if ('origin' in existing && 'origin' in incoming)
    return existing.origin === incoming.origin;
  return true;
}

function timelineWithRun(
  state: TimelineState,
  runId: string,
  run: RunTimeline,
): TimelineState {
  return { ...state, runs: { ...state.runs, [runId]: run } };
}

function addTimelineDiagnostic(
  state: TimelineState,
  runId: string,
  activityId: TimelineActivityId,
  sequence: number | null,
): TimelineState {
  const diagnostics = [
    ...state.diagnostics,
    { code: 'identity_kind_conflict' as const, runId, activityId, sequence },
  ];
  return { ...state, diagnostics: diagnostics.slice(-20) };
}

function upsertTimelineEntry(
  state: TimelineState,
  runId: string,
  run: RunTimeline,
  entry: TimelineEntry,
  sequence: number,
  onExisting?: (existing: TimelineEntry, index: number) => TimelineEntry | null,
): { state: TimelineState; created: boolean; conflict: boolean } {
  const index = timelineEntryIndex(run, entry.activityId);
  if (index < 0) {
    const nextRun = {
      ...run,
      entries: [...run.entries, entry],
    };
    return {
      state: timelineWithRun(state, runId, nextRun),
      created: true,
      conflict: false,
    };
  }
  const existing = run.entries[index]!;
  if (!sameTimelineEntryKind(existing, entry)) {
    return {
      state: addTimelineDiagnostic(state, runId, entry.activityId, sequence),
      created: false,
      conflict: true,
    };
  }
  const replacement = onExisting?.(existing, index) ?? entry;
  if (replacement === null) {
    return { state, created: false, conflict: false };
  }
  const entries = run.entries.slice();
  entries[index] = replacement;
  return {
    state: timelineWithRun(state, runId, { ...run, entries }),
    created: false,
    conflict: false,
  };
}

function timelineToolEntry(
  runId: string,
  sequence: number,
  tool: ParsedTool,
): TimelineToolEntry {
  return {
    runId,
    activityId: timelineId('wire', tool.activityId),
    firstSequence: sequence,
    lastSequence: sequence,
    kind: 'tool',
    origin: 'tool_status',
    category: tool.category,
    sourceActivityId: tool.activityId,
    status: tool.status,
    label: tool.label,
    summary: tool.summary,
    ...(tool.toolName ? { toolName: tool.toolName } : {}),
    ...(tool.parentActivityId
      ? { parentActivityId: timelineId('wire', tool.parentActivityId) }
      : {}),
    ...(tool.detailKind ? { detailKind: tool.detailKind } : {}),
    ...(tool.detailText ? { detailText: tool.detailText } : {}),
    ...(tool.exitCode !== undefined ? { exitCode: tool.exitCode } : {}),
  };
}

function timelineChildEntry(
  runId: string,
  sequence: number,
  child: ParsedChild & { readonly parentActivityId: string },
): TimelineEntry {
  const base = {
    runId,
    activityId: timelineId('wire', child.activityId),
    firstSequence: sequence,
    lastSequence: sequence,
    parentActivityId: timelineId('wire', child.parentActivityId),
    status: child.status,
    label: child.label,
    summary: child.summary,
    ...(child.detailKind ? { detailKind: child.detailKind } : {}),
    ...(child.detailText ? { detailText: child.detailText } : {}),
    ...(child.exitCode !== undefined ? { exitCode: child.exitCode } : {}),
  } as const;
  if (child.kind === 'assistant')
    return { ...base, kind: 'agentText', origin: 'child_timeline_item' };
  if (child.kind === 'reasoning')
    return { ...base, kind: 'thinking', origin: 'child_timeline_item' };
  return {
    ...base,
    kind: 'tool',
    origin: 'child_timeline_item',
    sourceActivityId: child.activityId,
  };
}

function timelineUpdateSequence(
  run: RunTimeline,
  sequence: number,
): RunTimeline {
  return { ...run, lastSequence: sequence };
}

function applyTimelineRunEvent(
  state: TimelineState,
  runId: string,
  event: RunStreamEvent,
): TimelineState {
  if (
    !runId ||
    !event ||
    typeof event !== 'object' ||
    !Number.isSafeInteger(event.sequence) ||
    event.sequence < 1 ||
    typeof event.type !== 'string'
  )
    return state;
  const previousRun = timelineRunFor(state, runId);
  if (
    event.sequence <= previousRun.lastSequence ||
    timelineTerminal(previousRun)
  )
    return state;
  let run = timelineUpdateSequence(previousRun, event.sequence);
  let nextState = timelineWithRun(state, runId, run);
  if (
    event.type === 'started' ||
    event.type === 'succeeded' ||
    event.type === 'failed' ||
    event.type === 'cancelled'
  ) {
    const entry: LifecycleEntry = {
      runId,
      activityId: timelineId('local', `lifecycle:${event.sequence}`),
      firstSequence: event.sequence,
      lastSequence: event.sequence,
      kind: 'lifecycle',
      status: event.type,
    };
    return upsertTimelineEntry(nextState, runId, run, entry, event.sequence)
      .state;
  }
  if (event.type !== 'output') return nextState;
  const payload = asRecord(event.payload);
  if (!payload || typeof payload.kind !== 'string') return nextState;

  if (payload.kind === 'assistant_text') {
    if (typeof payload.text !== 'string') return nextState;
    const openId = run.openAgentTextActivityId;
    const openIndex = openId ? timelineEntryIndex(run, openId) : -1;
    const open = openIndex >= 0 ? run.entries[openIndex] : undefined;
    if (open && open.kind === 'agentText' && open.origin === 'assistant_text') {
      if (payload.text === open.text) return nextState;
      if (!payload.text.startsWith(open.text)) return nextState;
      const entries = run.entries.slice();
      entries[openIndex] = {
        ...open,
        text: payload.text,
        status: 'streaming',
        lastSequence: event.sequence,
      };
      return timelineWithRun(nextState, runId, {
        ...run,
        entries,
        lastSequence: event.sequence,
      });
    }
    const entry: AgentTextEntry = {
      runId,
      activityId: timelineId('local', `agent-text:${event.sequence}`),
      firstSequence: event.sequence,
      lastSequence: event.sequence,
      kind: 'agentText',
      origin: 'assistant_text',
      text: payload.text,
      status: 'streaming',
    };
    return timelineWithRun(nextState, runId, {
      ...run,
      entries: [...run.entries, entry],
      openAgentTextActivityId: entry.activityId,
    });
  }

  if (payload.kind === 'tool_status') {
    const tool = parseTool(payload);
    if (!tool) return nextState;
    const entry = timelineToolEntry(runId, event.sequence, tool);
    const index = timelineEntryIndex(run, entry.activityId);
    if (index >= 0) {
      const existing = run.entries[index]!;
      if (!sameTimelineEntryKind(existing, entry))
        return addTimelineDiagnostic(
          nextState,
          runId,
          entry.activityId,
          event.sequence,
        );
      const existingTool = existing as TimelineToolEntry;
      if (!canAdvanceTool(existingTool.status, tool.status)) return nextState;
      const merged: TimelineToolEntry = {
        ...existingTool,
        ...entry,
        firstSequence: existingTool.firstSequence,
        lastSequence: event.sequence,
        ...(existingTool.detailKind && !entry.detailKind
          ? { detailKind: existingTool.detailKind }
          : {}),
        ...(existingTool.detailText && !entry.detailText
          ? { detailText: existingTool.detailText }
          : {}),
        ...(existingTool.exitCode !== undefined && entry.exitCode === undefined
          ? { exitCode: existingTool.exitCode }
          : {}),
      };
      const entries = run.entries.slice();
      entries[index] = merged;
      return timelineWithRun(nextState, runId, { ...run, entries });
    }
    const result = upsertTimelineEntry(
      nextState,
      runId,
      run,
      entry,
      event.sequence,
    );
    if (result.conflict) return result.state;
    if (!tool.parentActivityId) {
      const currentRun = timelineRunFor(result.state, runId);
      return timelineWithRun(result.state, runId, {
        ...currentRun,
        openAgentTextActivityId: null,
      });
    }
    return result.state;
  }

  if (payload.kind === 'child_timeline_item') {
    const child = parseChild(payload);
    if (!child) return nextState;
    const entry = timelineChildEntry(runId, event.sequence, child);
    const index = timelineEntryIndex(run, entry.activityId);
    if (index >= 0) {
      const existing = run.entries[index]!;
      if (!sameTimelineEntryKind(existing, entry))
        return addTimelineDiagnostic(
          nextState,
          runId,
          entry.activityId,
          event.sequence,
        );
      const existingChild = existing as
        | Extract<AgentTextEntry, { origin: 'child_timeline_item' }>
        | Extract<ThinkingEntry, { origin: 'child_timeline_item' }>
        | TimelineToolEntry;
      if (!canAdvanceTool(existingChild.status, child.status)) return nextState;
      const merged = {
        ...existingChild,
        ...entry,
        firstSequence: existingChild.firstSequence,
        lastSequence: event.sequence,
        ...('detailKind' in existingChild && !('detailKind' in entry)
          ? { detailKind: existingChild.detailKind }
          : {}),
        ...('detailText' in existingChild && !('detailText' in entry)
          ? { detailText: existingChild.detailText }
          : {}),
        ...('exitCode' in existingChild && !('exitCode' in entry)
          ? { exitCode: existingChild.exitCode }
          : {}),
      } as TimelineEntry;
      const entries = run.entries.slice();
      entries[index] = merged;
      return timelineWithRun(nextState, runId, { ...run, entries });
    }
    return upsertTimelineEntry(nextState, runId, run, entry, event.sequence)
      .state;
  }

  if (payload.kind === 'reasoning_progress') {
    if (
      !isReasoningStatus(payload.status) ||
      (payload.text !== undefined && typeof payload.text !== 'string')
    )
      return nextState;
    const thinkingIndex = [...run.entries]
      .map((entry, index) => ({ entry, index }))
      .reverse()
      .find(
        ({ entry }) =>
          entry.kind === 'thinking' && entry.origin === 'reasoning_progress',
      );
    if (
      thinkingIndex &&
      thinkingIndex.entry.kind === 'thinking' &&
      (thinkingIndex.entry.status === 'started' ||
        thinkingIndex.entry.status === 'completed') &&
      payload.status === 'completed'
    ) {
      const existing = thinkingIndex.entry as Extract<
        ThinkingEntry,
        { origin: 'reasoning_progress' }
      >;
      const entries = run.entries.slice();
      entries[thinkingIndex.index] = {
        ...existing,
        status: 'completed',
        lastSequence: event.sequence,
        ...(typeof payload.text === 'string' ? { text: payload.text } : {}),
      };
      return timelineWithRun(nextState, runId, { ...run, entries });
    }
    if (
      thinkingIndex &&
      thinkingIndex.entry.kind === 'thinking' &&
      thinkingIndex.entry.status === 'started' &&
      payload.status === 'started'
    ) {
      const existing = thinkingIndex.entry as Extract<
        ThinkingEntry,
        { origin: 'reasoning_progress' }
      >;
      const entries = run.entries.slice();
      entries[thinkingIndex.index] = {
        ...existing,
        lastSequence: event.sequence,
        ...(typeof payload.text === 'string' ? { text: payload.text } : {}),
      };
      return timelineWithRun(nextState, runId, { ...run, entries });
    }
    const entry: ThinkingEntry = {
      runId,
      activityId: timelineId('local', `thinking:${event.sequence}`),
      firstSequence: event.sequence,
      lastSequence: event.sequence,
      kind: 'thinking',
      origin: 'reasoning_progress',
      status: payload.status,
      ...(typeof payload.text === 'string' ? { text: payload.text } : {}),
    };
    return timelineWithRun(nextState, runId, {
      ...run,
      entries: [...run.entries, entry],
    });
  }

  if (payload.kind === 'permission') {
    const permission = parsePermission(payload);
    if (!permission) return nextState;
    const activityId = timelineId('wire', permission.activityId);
    const entry: ApprovalEntry = {
      runId,
      activityId,
      firstSequence: event.sequence,
      lastSequence: event.sequence,
      kind: 'approval',
      sourceActivityId: permission.activityId,
      category: permission.category,
      status: permission.status,
      ...(permission.decision ? { decision: permission.decision } : {}),
      summary: permission.summary,
    };
    const index = timelineEntryIndex(run, activityId);
    if (index >= 0) {
      const existing = run.entries[index]!;
      if (existing.kind !== 'approval')
        return addTimelineDiagnostic(
          nextState,
          runId,
          activityId,
          event.sequence,
        );
      if (!canAdvancePermission(existing.status, permission.status))
        return nextState;
      const entries = run.entries.slice();
      entries[index] = {
        ...existing,
        ...entry,
        firstSequence: existing.firstSequence,
        lastSequence: event.sequence,
      };
      return timelineWithRun(nextState, runId, { ...run, entries });
    }
    return upsertTimelineEntry(nextState, runId, run, entry, event.sequence)
      .state;
  }

  if (payload.kind === 'usage') {
    const usage = parseUsage(payload);
    if (!usage) return nextState;
    const activityId = timelineId('local', 'usage');
    const index = timelineEntryIndex(run, activityId);
    if (index >= 0) {
      const existing = run.entries[index]!;
      if (existing.kind !== 'usage')
        return addTimelineDiagnostic(
          nextState,
          runId,
          activityId,
          event.sequence,
        );
      const entries = run.entries.slice();
      entries[index] = {
        ...existing,
        usage: { ...existing.usage, ...usage },
        lastSequence: event.sequence,
      };
      return timelineWithRun(nextState, runId, { ...run, entries });
    }
    const entry: UsageEntry = {
      runId,
      activityId,
      firstSequence: event.sequence,
      lastSequence: event.sequence,
      kind: 'usage',
      usage,
    };
    return upsertTimelineEntry(nextState, runId, run, entry, event.sequence)
      .state;
  }
  return nextState;
}

export function applyTimelineEnvelope(
  state: TimelineState,
  envelope: TimelineEnvelope,
): TimelineState {
  if (
    !state ||
    !envelope ||
    typeof envelope.runId !== 'string' ||
    !envelope.runId
  )
    return state;
  const runId = envelope.runId;
  const update = envelope.update;
  if (!update || typeof update !== 'object') return state;
  if (update.kind === 'runEvent')
    return applyTimelineRunEvent(state, runId, update.event);
  const run = timelineRunFor(state, runId);
  if (update.kind === 'prompt') {
    if (typeof update.text !== 'string') return state;
    const messageId =
      typeof update.messageId === 'string' && update.messageId
        ? update.messageId
        : 'assignment';
    const activityId = timelineId('local', `prompt:${messageId}`);
    if (timelineEntryIndex(run, activityId) >= 0)
      return timelineWithRun(state, runId, run);
    const entry: PromptEntry = {
      runId,
      activityId,
      firstSequence: null,
      lastSequence: null,
      kind: 'prompt',
      text: update.text,
      ...(typeof update.messageId === 'string' && update.messageId
        ? { messageId: update.messageId }
        : {}),
    };
    return timelineWithRun(state, runId, {
      ...run,
      entries: [...run.entries, entry],
    });
  }
  if (update.kind === 'canonicalAgentText') {
    if (typeof update.text !== 'string') return state;
    const index = [...run.entries].findLastIndex(
      (entry) =>
        entry.kind === 'agentText' && entry.origin === 'assistant_text',
    );
    if (index >= 0) {
      const existing = run.entries[index] as Extract<
        AgentTextEntry,
        { origin: 'assistant_text' }
      >;
      const entries = run.entries.slice();
      entries[index] = {
        ...existing,
        text: update.text,
        status: 'saved',
        ...(typeof update.messageId === 'string' && update.messageId
          ? { messageId: update.messageId }
          : {}),
      };
      return timelineWithRun(state, runId, {
        ...run,
        entries,
        openAgentTextActivityId: sameTimelineId(
          run.openAgentTextActivityId ?? timelineId('local', ''),
          existing.activityId,
        )
          ? null
          : run.openAgentTextActivityId,
      });
    }
    const entry: AgentTextEntry = {
      runId,
      activityId: timelineId('local', 'agent-text:canonical'),
      firstSequence: null,
      lastSequence: null,
      kind: 'agentText',
      origin: 'assistant_text',
      text: update.text,
      status: 'saved',
      ...(typeof update.messageId === 'string' && update.messageId
        ? { messageId: update.messageId }
        : {}),
    };
    return timelineWithRun(state, runId, {
      ...run,
      entries: [...run.entries, entry],
      openAgentTextActivityId: null,
    });
  }
  return state;
}

export function applyTimelineEnvelopes(
  state: TimelineState,
  envelopes: readonly TimelineEnvelope[],
): TimelineState {
  return envelopes.reduce(applyTimelineEnvelope, state);
}

/** Entries representing top-level activity in a run's ordered timeline. */
export type TimelineActivityEntry =
  | Extract<ThinkingEntry, { readonly origin: 'reasoning_progress' }>
  | TopLevelTimelineToolEntry
  | ApprovalEntry
  | UsageEntry;

/** Entries emitted by child_timeline_item updates. */
export type TimelineChildEntry =
  | Extract<AgentTextEntry, { readonly origin: 'child_timeline_item' }>
  | Extract<ThinkingEntry, { readonly origin: 'child_timeline_item' }>
  | Extract<TimelineToolEntry, { readonly origin: 'child_timeline_item' }>
  | ParentLinkedTimelineToolEntry;

/** Select top-level activity entries in their original insertion order. */
export function selectActivityEntries(
  state: TimelineState,
  runId: string,
): readonly TimelineActivityEntry[] {
  const run = timelineRunFor(state, runId);
  return run.entries.filter(
    (entry): entry is TimelineActivityEntry =>
      (entry.kind === 'thinking' && entry.origin === 'reasoning_progress') ||
      (entry.kind === 'tool' &&
        entry.origin === 'tool_status' &&
        entry.parentActivityId === undefined) ||
      entry.kind === 'approval' ||
      entry.kind === 'usage',
  );
}

/** Group child timeline entries by their raw parent activity id. */
export function selectChildEntriesByParent(
  state: TimelineState,
  runId: string,
): ReadonlyMap<string, readonly TimelineChildEntry[]> {
  const run = timelineRunFor(state, runId);
  const children = new Map<string, TimelineChildEntry[]>();
  for (const entry of run.entries) {
    if (
      (entry.kind === 'agentText' ||
        entry.kind === 'thinking' ||
        entry.kind === 'tool') &&
      entry.origin === 'child_timeline_item'
    ) {
      const parentId = entry.parentActivityId.value;
      const existing = children.get(parentId);
      if (existing) existing.push(entry);
      else children.set(parentId, [entry]);
      continue;
    }
    if (
      entry.kind !== 'tool' ||
      entry.origin !== 'tool_status' ||
      entry.parentActivityId === undefined
    )
      continue;
    const child = entry as ParentLinkedTimelineToolEntry;
    const parentId = child.parentActivityId.value;
    const existing = children.get(parentId);
    if (existing) existing.push(child);
    else children.set(parentId, [child]);
  }
  return children;
}

/** Select the last lifecycle entry, if one exists. */
export function selectCurrentLifecycle(
  state: TimelineState,
  runId: string,
): LifecycleEntry | null {
  const run = timelineRunFor(state, runId);
  for (let index = run.entries.length - 1; index >= 0; index -= 1) {
    const entry = run.entries[index];
    if (entry?.kind === 'lifecycle') return entry;
  }
  return null;
}

/** Select the last terminal lifecycle entry, if one exists. */
export function selectTerminalLifecycle(
  state: TimelineState,
  runId: string,
): LifecycleEntry | null {
  const run = timelineRunFor(state, runId);
  for (let index = run.entries.length - 1; index >= 0; index -= 1) {
    const entry = run.entries[index];
    if (
      entry?.kind === 'lifecycle' &&
      (entry.status === 'succeeded' ||
        entry.status === 'failed' ||
        entry.status === 'cancelled')
    )
      return entry;
  }
  return null;
}

/** Select the run's usage entry, if one exists. */
export function selectUsageEntry(
  state: TimelineState,
  runId: string,
): UsageEntry | null {
  const run = timelineRunFor(state, runId);
  for (const entry of run.entries) {
    if (entry.kind === 'usage') return entry;
  }
  return null;
}

/** Select the final top-level assistant text entry, if one exists. */
export function selectFinalAgentText(
  state: TimelineState,
  runId: string,
): Extract<AgentTextEntry, { readonly origin: 'assistant_text' }> | null {
  const run = timelineRunFor(state, runId);
  for (let index = run.entries.length - 1; index >= 0; index -= 1) {
    const entry = run.entries[index];
    if (entry?.kind === 'agentText' && entry.origin === 'assistant_text')
      return entry;
  }
  return null;
}

/** Select all prompt entries in their original insertion order. */
export function selectPromptEntries(
  state: TimelineState,
  runId: string,
): readonly PromptEntry[] {
  const run = timelineRunFor(state, runId);
  return run.entries.filter(
    (entry): entry is PromptEntry => entry.kind === 'prompt',
  );
}

/** Select all top-level assistant text entries in insertion order. */
export function selectAgentTextEntries(
  state: TimelineState,
  runId: string,
): readonly Extract<AgentTextEntry, { readonly origin: 'assistant_text' }>[] {
  const run = timelineRunFor(state, runId);
  return run.entries.filter(
    (
      entry,
    ): entry is Extract<
      AgentTextEntry,
      { readonly origin: 'assistant_text' }
    > => entry.kind === 'agentText' && entry.origin === 'assistant_text',
  );
}
