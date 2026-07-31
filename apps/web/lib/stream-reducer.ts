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

export type ToolProjection = {
  readonly activityId: string;
  readonly category: ToolCategory;
  readonly status: ToolStatus;
  readonly label: string;
  readonly summary: string;
  readonly parentActivityId?: string;
  readonly detailKind?: DetailKind;
  readonly detailText?: string;
  readonly exitCode?: number;
};

export type DetailKind =
  'shell' | 'read' | 'write' | 'edit' | 'search' | 'fetch';

export type ChildProjection = {
  readonly activityId: string;
  readonly kind: 'assistant' | 'reasoning' | 'tool';
  readonly status: ToolStatus;
  readonly label: string;
  readonly summary: string;
  readonly detailKind?: DetailKind;
  readonly detailText?: string;
  readonly exitCode?: number;
};

export type ReasoningProjection = {
  readonly status: ReasoningStatus;
  readonly text?: string;
};

export type PermissionProjection = {
  readonly activityId: string;
  readonly category: PermissionCategory;
  readonly status: PermissionStatus;
  readonly decision?: PermissionDecision;
  readonly summary: string;
};

export type UsageProjection = {
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly outputTokens?: number;
  readonly totalCostUsd?: number;
  readonly contextWindowMaxTokens?: number;
  readonly contextWindowUsedTokens?: number;
};

export type StreamProjection = {
  readonly lastSequence: number;
  readonly assistantText: string | null;
  readonly reasoning: ReasoningProjection | null;
  readonly tools: Readonly<Record<string, ToolProjection>>;
  readonly activityOrder: readonly string[];
  readonly childrenByParent: Readonly<
    Record<string, readonly ChildProjection[]>
  >;
  readonly permissions: Readonly<Record<string, PermissionProjection>>;
  readonly usage: UsageProjection | null;
  readonly lifecycle: LifecycleEvent | null;
  readonly terminal: Exclude<LifecycleEvent, 'started'> | null;
};

export type ToolActivityGroups = {
  readonly roots: readonly ToolProjection[];
  readonly childrenByParent: Readonly<
    Record<string, readonly ChildProjection[]>
  >;
};

export const initialStreamProjection: StreamProjection = {
  lastSequence: 0,
  assistantText: null,
  reasoning: null,
  tools: {},
  activityOrder: [],
  childrenByParent: {},
  permissions: {},
  usage: null,
  lifecycle: null,
  terminal: null,
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

export function reduceRunStreamEvent(
  state: StreamProjection,
  event: RunStreamEvent,
): StreamProjection {
  if (event.sequence <= state.lastSequence) return state;
  if (state.terminal) return state;
  const next: StreamProjection = {
    ...state,
    lastSequence: event.sequence,
  };
  if (event.type === 'started') return { ...next, lifecycle: 'started' };
  if (
    event.type === 'succeeded' ||
    event.type === 'failed' ||
    event.type === 'cancelled'
  )
    return { ...next, lifecycle: event.type, terminal: event.type };
  if (event.type !== 'output') return next;
  const payload = asRecord(event.payload);
  if (!payload || typeof payload.kind !== 'string') return next;
  switch (payload.kind) {
    case 'assistant_text':
      return typeof payload.text === 'string'
        ? { ...next, assistantText: payload.text }
        : next;
    case 'reasoning_progress':
      return isReasoningStatus(payload.status) &&
        (payload.text === undefined || typeof payload.text === 'string')
        ? {
            ...next,
            reasoning: {
              status: payload.status,
              ...(typeof payload.text === 'string'
                ? { text: payload.text }
                : state.reasoning?.text
                  ? { text: state.reasoning.text }
                  : {}),
            },
          }
        : next;
    case 'tool_status': {
      const tool = parseTool(payload);
      if (!tool) return next;
      const previous = state.tools[tool.activityId];
      if (previous && !canAdvanceTool(previous.status, tool.status))
        return next;
      return {
        ...next,
        tools: { ...state.tools, [tool.activityId]: tool },
        activityOrder: previous
          ? state.activityOrder
          : [...state.activityOrder, tool.activityId],
      };
    }
    case 'child_timeline_item': {
      const child = parseChild(payload);
      if (!child) return next;
      const previous = state.childrenByParent[child.parentActivityId] ?? [];
      const existing = previous.find(
        (item) => item.activityId === child.activityId,
      );
      if (existing && !canAdvanceTool(existing.status, child.status))
        return next;
      return {
        ...next,
        childrenByParent: {
          ...state.childrenByParent,
          [child.parentActivityId]: existing
            ? previous.map((item) =>
                item.activityId === child.activityId ? child : item,
              )
            : [...previous, child],
        },
        activityOrder: existing
          ? state.activityOrder
          : [...state.activityOrder, child.activityId],
      };
    }
    case 'usage': {
      const usage = parseUsage(payload);
      return usage
        ? { ...next, usage: { ...(state.usage ?? {}), ...usage } }
        : next;
    }
    case 'permission': {
      const permission = parsePermission(payload);
      if (!permission) return next;
      const previous = state.permissions[permission.activityId];
      if (previous && !canAdvancePermission(previous.status, permission.status))
        return next;
      return {
        ...next,
        permissions: {
          ...state.permissions,
          [permission.activityId]: permission,
        },
      };
    }
    default:
      return next;
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

function parseTool(value: Record<string, unknown>): ToolProjection | null {
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
    ...(parentActivityId ? { parentActivityId } : {}),
    ...parseDetailFields(value),
  };
}

function parseChild(value: Record<string, unknown>):
  | (ChildProjection & {
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

export function deriveToolActivityGroups(
  tools: Readonly<Record<string, ToolProjection>>,
  childrenByParent: Readonly<Record<string, readonly ChildProjection[]>> = {},
  activityOrder: readonly string[] = Object.keys(tools),
): ToolActivityGroups {
  const values = Object.values(tools);
  const rootIds = new Set(
    values
      .filter((tool) => tool.category === 'subagent' && !tool.parentActivityId)
      .map((tool) => tool.activityId),
  );
  const roots: ToolProjection[] = [];
  const legacyChildrenByParent: Record<string, ToolProjection[]> = {};
  for (const activityId of activityOrder) {
    const tool = tools[activityId];
    if (!tool) continue;
    if (tool.parentActivityId) {
      if (rootIds.has(tool.parentActivityId)) {
        (legacyChildrenByParent[tool.parentActivityId] ??= []).push(tool);
      }
      /* Orphan child — stay in flat map for late parent arrival; suppress from render. */
    } else {
      roots.push(tool);
    }
  }
  const orderedChildren: Record<string, ChildProjection[]> = {};
  for (const root of roots) {
    const legacyChildren = (legacyChildrenByParent[root.activityId] ?? []).map(
      (tool): ChildProjection => ({
        activityId: tool.activityId,
        kind: 'tool',
        status: tool.status,
        label: tool.label,
        summary: tool.summary,
        ...(tool.detailKind ? { detailKind: tool.detailKind } : {}),
        ...(tool.detailText ? { detailText: tool.detailText } : {}),
        ...(tool.exitCode !== undefined ? { exitCode: tool.exitCode } : {}),
      }),
    );
    const directChildren = childrenByParent[root.activityId] ?? [];
    const childrenById = new Map<string, ChildProjection>(
      [...legacyChildren, ...directChildren].map((child) => [
        child.activityId,
        child,
      ]),
    );
    orderedChildren[root.activityId] = [
      ...activityOrder
        .map((activityId) => childrenById.get(activityId))
        .filter((child): child is ChildProjection => child !== undefined),
      ...[...childrenById.values()].filter(
        (child) => !activityOrder.includes(child.activityId),
      ),
    ];
  }
  return { roots, childrenByParent: orderedChildren };
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
): PermissionProjection | null {
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

function parseUsage(value: Record<string, unknown>): UsageProjection | null {
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

function isChildKind(value: unknown): value is ChildProjection['kind'] {
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
