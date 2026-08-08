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
export type Provider = 'opencode' | 'claude' | 'codex';

export type RunStreamEvent = {
  readonly sequence: number;
  readonly type: string;
  /** Source event timestamp; parser normalizes missing/invalid values to null. */
  readonly createdAt?: string | null;
  readonly payload?: unknown;
};

type ParsedTool = {
  readonly activityId: string;
  readonly category: ToolCategory;
  readonly status: ToolStatus;
  readonly label: string;
  readonly summary: string;
  readonly provider?: Provider;
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
  readonly provider?: Provider;
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
      createdAt: validCreatedAt(record.created_at) ? record.created_at : null,
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

function validCreatedAt(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length !== 24 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  )
    return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function parseProvider(value: unknown): Provider | undefined {
  return value === 'opencode' || value === 'claude' || value === 'codex'
    ? value
    : undefined;
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
  const provider = parseProvider(value.provider);
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
    ...(provider ? { provider } : {}),
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
  const provider = parseProvider(value.provider);
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
    ...(provider ? { provider } : {}),
    ...parseDetailFields(value),
  };
}

function eventCreatedAt(event: RunStreamEvent): string | null {
  if (event.createdAt !== undefined)
    return validCreatedAt(event.createdAt) ? event.createdAt : null;
  return null;
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
  Readonly<{
    firstSequence: number | null;
    lastSequence: number | null;
    firstCreatedAt: string | null;
    lastCreatedAt: string | null;
  }>;

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
        readonly provider?: Provider;
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
        readonly provider?: Provider;
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
    provider?: Provider;
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

export type TerminalLifecycleEntry = Omit<LifecycleEntry, 'status'> & {
  readonly status: Exclude<LifecycleEvent, 'started'>;
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
  readonly code: 'identity_kind_conflict' | 'assistant_text_non_prefix';
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
  code: TimelineDiagnostic['code'] = 'identity_kind_conflict',
): TimelineState {
  const diagnostics = [
    ...state.diagnostics,
    { code, runId, activityId, sequence },
  ];
  return { ...state, diagnostics: diagnostics.slice(-20) };
}

function timelineEnvelopeSequence(envelope: TimelineEnvelope): number {
  if (envelope.update.kind !== 'runEvent') return Number.MAX_SAFE_INTEGER;
  return envelope.update.event.sequence;
}

type TimelineEntryOutcome = 'created' | 'merged' | 'rejected' | 'conflict';

type TimelineEntryMergeOptions = Readonly<{
  readonly locate?: (run: RunTimeline, incoming: TimelineEntry) => number;
  readonly merge?: (
    existing: TimelineEntry,
    incoming: TimelineEntry,
  ) => TimelineEntry | null;
}>;

function mergeTimelineEntryState(
  state: TimelineState,
  runId: string,
  run: RunTimeline,
  entry: TimelineEntry,
  sequence: number,
  options: TimelineEntryMergeOptions = {},
): { state: TimelineState; outcome: TimelineEntryOutcome } {
  const index =
    options.locate?.(run, entry) ?? timelineEntryIndex(run, entry.activityId);
  if (index < 0) {
    const created = {
      ...entry,
      runId,
      firstSequence: entry.firstSequence ?? sequence,
      lastSequence: sequence,
      firstCreatedAt: entry.firstCreatedAt ?? null,
      lastCreatedAt: entry.lastCreatedAt ?? null,
    };
    return {
      state: timelineWithRun(state, runId, {
        ...run,
        entries: [...run.entries, created],
      }),
      outcome: 'created',
    };
  }
  const existing = run.entries[index]!;
  if (!sameTimelineEntryKind(existing, entry)) {
    return {
      state: addTimelineDiagnostic(state, runId, entry.activityId, sequence),
      outcome: 'conflict',
    };
  }
  const replacement = options.merge ? options.merge(existing, entry) : entry;
  if (replacement === null) {
    return { state, outcome: 'rejected' };
  }
  const merged = {
    ...replacement,
    runId: existing.runId,
    activityId: existing.activityId,
    firstSequence: existing.firstSequence,
    lastSequence: sequence,
    firstCreatedAt: existing.firstCreatedAt ?? null,
    lastCreatedAt: replacement.lastCreatedAt ?? existing.lastCreatedAt,
  } as TimelineEntry;
  const entries = run.entries.slice();
  entries[index] = merged;
  return {
    state: timelineWithRun(state, runId, { ...run, entries }),
    outcome: 'merged',
  };
}

function timelineToolEntry(
  runId: string,
  sequence: number,
  tool: ParsedTool,
  createdAt: string | null,
): TimelineToolEntry {
  return {
    runId,
    activityId: timelineId('wire', tool.activityId),
    firstSequence: sequence,
    lastSequence: sequence,
    firstCreatedAt: createdAt,
    lastCreatedAt: createdAt,
    kind: 'tool',
    origin: 'tool_status',
    category: tool.category,
    sourceActivityId: tool.activityId,
    status: tool.status,
    label: tool.label,
    summary: tool.summary,
    ...(tool.provider ? { provider: tool.provider } : {}),
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
  createdAt: string | null,
): TimelineEntry {
  const base = {
    runId,
    activityId: timelineId('wire', child.activityId),
    firstSequence: sequence,
    lastSequence: sequence,
    firstCreatedAt: createdAt,
    lastCreatedAt: createdAt,
    parentActivityId: timelineId('wire', child.parentActivityId),
    status: child.status,
    label: child.label,
    summary: child.summary,
    ...(child.provider ? { provider: child.provider } : {}),
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
      firstCreatedAt: eventCreatedAt(event),
      lastCreatedAt: eventCreatedAt(event),
      kind: 'lifecycle',
      status: event.type,
    };
    return mergeTimelineEntryState(nextState, runId, run, entry, event.sequence)
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
      const createdAt = eventCreatedAt(event);
      if (payload.text === open.text)
        return mergeTimelineEntryState(
          nextState,
          runId,
          run,
          { ...open, lastCreatedAt: createdAt },
          event.sequence,
          {
            locate: () => openIndex,
            merge: (existing, incoming) => ({ ...existing, ...incoming }),
          },
        ).state;
      if (!payload.text.startsWith(open.text))
        return addTimelineDiagnostic(
          nextState,
          runId,
          open.activityId,
          event.sequence,
          'assistant_text_non_prefix',
        );
      return mergeTimelineEntryState(
        nextState,
        runId,
        run,
        {
          ...open,
          text: payload.text,
          status: 'streaming',
          lastCreatedAt: createdAt,
        },
        event.sequence,
        {
          locate: () => openIndex,
          merge: (existing, incoming) => ({ ...existing, ...incoming }),
        },
      ).state;
    }
    const createdAt = eventCreatedAt(event);
    const entry: AgentTextEntry = {
      runId,
      activityId: timelineId('local', `agent-text:${event.sequence}`),
      firstSequence: event.sequence,
      lastSequence: event.sequence,
      firstCreatedAt: createdAt,
      lastCreatedAt: createdAt,
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
    const entry = timelineToolEntry(
      runId,
      event.sequence,
      tool,
      eventCreatedAt(event),
    );
    const result = mergeTimelineEntryState(
      nextState,
      runId,
      run,
      entry,
      event.sequence,
      {
        merge: (existing, incoming) => {
          const existingTool = existing as TimelineToolEntry;
          if (!canAdvanceTool(existingTool.status, tool.status)) return null;
          return { ...existingTool, ...incoming };
        },
      },
    );
    if (result.outcome === 'created' && !tool.parentActivityId) {
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
    const entry = timelineChildEntry(
      runId,
      event.sequence,
      child,
      eventCreatedAt(event),
    );
    const result = mergeTimelineEntryState(
      nextState,
      runId,
      run,
      entry,
      event.sequence,
      {
        merge: (existing, incoming) => {
          const existingChild = existing as
            | Extract<AgentTextEntry, { origin: 'child_timeline_item' }>
            | Extract<ThinkingEntry, { origin: 'child_timeline_item' }>
            | TimelineToolEntry;
          if (!canAdvanceTool(existingChild.status, child.status)) return null;
          return { ...existingChild, ...incoming };
        },
      },
    );
    return result.state;
  }

  if (payload.kind === 'reasoning_progress') {
    if (
      !isReasoningStatus(payload.status) ||
      (payload.text !== undefined && typeof payload.text !== 'string')
    )
      return nextState;
    const latestThinking = [...run.entries]
      .map((entry, index) => ({ entry, index }))
      .reverse()
      .find(
        ({ entry }) =>
          entry.kind === 'thinking' && entry.origin === 'reasoning_progress',
      );
    const thinkingIndex =
      latestThinking?.entry.kind === 'thinking' &&
      latestThinking.entry.origin === 'reasoning_progress' &&
      latestThinking.entry.status === 'started'
        ? latestThinking.index
        : -1;
    const entry: ThinkingEntry = {
      runId,
      activityId: timelineId('local', `thinking:${event.sequence}`),
      firstSequence: event.sequence,
      lastSequence: event.sequence,
      firstCreatedAt: eventCreatedAt(event),
      lastCreatedAt: eventCreatedAt(event),
      kind: 'thinking',
      origin: 'reasoning_progress',
      status: payload.status,
      ...(typeof payload.text === 'string' ? { text: payload.text } : {}),
    };
    return mergeTimelineEntryState(
      nextState,
      runId,
      run,
      entry,
      event.sequence,
      {
        locate: () => thinkingIndex,
        merge: (existing, incoming) => ({ ...existing, ...incoming }),
      },
    ).state;
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
      firstCreatedAt: eventCreatedAt(event),
      lastCreatedAt: eventCreatedAt(event),
      kind: 'approval',
      sourceActivityId: permission.activityId,
      category: permission.category,
      status: permission.status,
      ...(permission.decision ? { decision: permission.decision } : {}),
      summary: permission.summary,
    };
    return mergeTimelineEntryState(
      nextState,
      runId,
      run,
      entry,
      event.sequence,
      {
        merge: (existing, incoming) => {
          const existingApproval = existing as ApprovalEntry;
          if (!canAdvancePermission(existingApproval.status, permission.status))
            return null;
          return { ...existingApproval, ...incoming };
        },
      },
    ).state;
  }

  if (payload.kind === 'usage') {
    const usage = parseUsage(payload);
    if (!usage) return nextState;
    const activityId = timelineId('local', 'usage');
    const entry: UsageEntry = {
      runId,
      activityId,
      firstSequence: event.sequence,
      lastSequence: event.sequence,
      firstCreatedAt: eventCreatedAt(event),
      lastCreatedAt: eventCreatedAt(event),
      kind: 'usage',
      usage,
    };
    return mergeTimelineEntryState(
      nextState,
      runId,
      run,
      entry,
      event.sequence,
      {
        merge: (existing, incoming) => {
          const existingUsage = existing as UsageEntry;
          const incomingUsage = incoming as UsageEntry;
          return {
            ...existingUsage,
            ...incomingUsage,
            usage: { ...existingUsage.usage, ...incomingUsage.usage },
          };
        },
      },
    ).state;
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
      firstCreatedAt: null,
      lastCreatedAt: null,
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
      firstCreatedAt: null,
      lastCreatedAt: null,
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
  let nextState = state;
  let index = 0;
  while (index < envelopes.length) {
    const first = envelopes[index]!;
    if (first.update.kind !== 'runEvent') {
      nextState = applyTimelineEnvelope(nextState, first);
      index += 1;
      continue;
    }
    const block: TimelineEnvelope[] = [];
    while (
      index < envelopes.length &&
      envelopes[index]!.update.kind === 'runEvent'
    ) {
      block.push(envelopes[index]!);
      index += 1;
    }
    const runtimeByRun = new Map<string, TimelineEnvelope[]>();
    for (const envelope of block) {
      const runtime = runtimeByRun.get(envelope.runId);
      if (runtime) runtime.push(envelope);
      else runtimeByRun.set(envelope.runId, [envelope]);
    }
    for (const runtime of runtimeByRun.values()) {
      runtime.sort(
        (left, right) =>
          timelineEnvelopeSequence(left) - timelineEnvelopeSequence(right),
      );
    }
    const runtimeOffsets = new Map<string, number>();
    for (const envelope of block) {
      const runtime = runtimeByRun.get(envelope.runId)!;
      const offset = runtimeOffsets.get(envelope.runId) ?? 0;
      runtimeOffsets.set(envelope.runId, offset + 1);
      nextState = applyTimelineEnvelope(nextState, runtime[offset]!);
    }
  }
  return nextState;
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
): TerminalLifecycleEntry | null {
  const run = timelineRunFor(state, runId);
  for (let index = run.entries.length - 1; index >= 0; index -= 1) {
    const entry = run.entries[index];
    if (
      entry?.kind === 'lifecycle' &&
      (entry.status === 'succeeded' ||
        entry.status === 'failed' ||
        entry.status === 'cancelled')
    )
      return entry as TerminalLifecycleEntry;
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
