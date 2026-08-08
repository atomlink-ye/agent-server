import 'server-only';

export type SafeRunEvent = {
  readonly sequence: number;
  readonly type: string;
  /** A validated source timestamp; malformed values are omitted. */
  readonly created_at?: string;
  readonly payload?: Readonly<Record<string, unknown>>;
};

const providers = new Set(['opencode', 'claude', 'codex']);

const toolCategories = new Set([
  'shell',
  'read',
  'edit',
  'write',
  'search',
  'fetch',
  'subagent',
  'other',
]);
const toolStatuses = new Set(['running', 'completed', 'failed', 'cancelled']);
const permissionCategories = new Set([
  'tool',
  'plan',
  'question',
  'mode',
  'other',
]);
const permissionStatuses = new Set(['requested', 'resolved']);

export function safeRunEvent(value: unknown): SafeRunEvent | null {
  const event = record(value);
  if (!event) return null;
  const sequence = event.sequence;
  const type = event.type;
  if (
    !Number.isSafeInteger(sequence) ||
    (sequence as number) < 1 ||
    typeof type !== 'string'
  )
    return null;
  if (['started', 'succeeded', 'failed', 'cancelled'].includes(type))
    return {
      sequence: sequence as number,
      type,
      ...(validCreatedAt(event.created_at)
        ? { created_at: event.created_at }
        : {}),
    };
  if (type !== 'output')
    return {
      sequence: sequence as number,
      type: 'output',
      ...(validCreatedAt(event.created_at)
        ? { created_at: event.created_at }
        : {}),
    };

  const payload = record(event.payload);
  const safePayload = safeOutputPayload(payload);
  return safePayload
    ? {
        sequence: sequence as number,
        type,
        ...(validCreatedAt(event.created_at)
          ? { created_at: event.created_at }
          : {}),
        payload: safePayload,
      }
    : {
        sequence: sequence as number,
        type,
        ...(validCreatedAt(event.created_at)
          ? { created_at: event.created_at }
          : {}),
      };
}

export function safeRunEventStream(body: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = '';
  const emitCompleteBlocks = (
    controller: TransformStreamDefaultController<Uint8Array>,
  ) => {
    const blocks = pending.split(/\r?\n\r?\n/u);
    pending = blocks.pop() ?? '';
    for (const block of blocks) {
      const event = safeSseBlock(block);
      if (event) controller.enqueue(encoder.encode(event));
    }
  };
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        pending += decoder.decode(chunk, { stream: true });
        emitCompleteBlocks(controller);
      },
      flush(controller) {
        pending += decoder.decode();
        if (!pending) return;
        const event = safeSseBlock(pending);
        if (event) controller.enqueue(encoder.encode(event));
      },
    }),
  );
}

function safeSseBlock(block: string): string | null {
  const data = block
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data) return null;
  const event = safeRunEvent(parseJson(data));
  return event
    ? `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
    : null;
}

function safeOutputPayload(
  payload: Record<string, unknown> | null,
): Readonly<Record<string, unknown>> | null {
  if (!payload || typeof payload.kind !== 'string') return null;
  if (payload.kind === 'assistant_text') {
    const text = requiredString(payload.text, 32_000);
    return text ? { kind: 'assistant_text', text } : null;
  }
  if (
    payload.kind === 'reasoning_progress' &&
    (payload.status === 'started' || payload.status === 'completed')
  ) {
    const text = optionalString(payload.text, 32_000);
    return {
      kind: 'reasoning_progress',
      status: payload.status,
      ...(text ? { text } : {}),
    };
  }
  if (
    payload.kind === 'tool_status' &&
    toolCategories.has(payload.category as string) &&
    toolStatuses.has(payload.status as string)
  ) {
    const activityId = requiredString(payload.activity_id, 256);
    const label = requiredString(payload.label, 120);
    const summary = requiredString(payload.summary, 2_000);
    if (!activityId || !label || !summary) return null;
    const category = payload.category as string;
    const status = payload.status as string;
    const parentActivityId = optionalString(payload.parent_activity_id, 256);
    const toolName = optionalString(payload.tool_name);
    const detailKind = isDetailKind(payload.detail_kind)
      ? payload.detail_kind
      : undefined;
    const detailText = optionalString(payload.detail_text, 12_000);
    const exitCode =
      typeof payload.exit_code === 'number' &&
      Number.isInteger(payload.exit_code)
        ? payload.exit_code
        : undefined;
    return {
      kind: 'tool_status',
      activity_id: activityId,
      category,
      status,
      label,
      summary,
      ...(providers.has(payload.provider as string)
        ? { provider: payload.provider as string }
        : {}),
      ...(toolName ? { tool_name: toolName } : {}),
      ...(detailKind ? { detail_kind: detailKind } : {}),
      ...(detailText ? { detail_text: detailText } : {}),
      ...(exitCode !== undefined ? { exit_code: exitCode } : {}),
      ...(parentActivityId ? { parent_activity_id: parentActivityId } : {}),
    };
  }
  if (
    payload.kind === 'child_timeline_item' &&
    toolStatuses.has(payload.status as string) &&
    ['assistant', 'reasoning', 'tool'].includes(payload.item_kind as string)
  ) {
    const activityId = requiredString(payload.activity_id, 256);
    const parentActivityId = requiredString(payload.parent_activity_id, 256);
    const label = requiredString(payload.label, 120);
    const summary = requiredString(payload.summary, 2_000);
    if (!activityId || !parentActivityId || !label || !summary) return null;
    const detailKind = isDetailKind(payload.detail_kind)
      ? payload.detail_kind
      : undefined;
    const detailText = optionalString(payload.detail_text, 12_000);
    const exitCode =
      typeof payload.exit_code === 'number' &&
      Number.isInteger(payload.exit_code)
        ? payload.exit_code
        : undefined;
    return {
      kind: 'child_timeline_item',
      activity_id: activityId,
      parent_activity_id: parentActivityId,
      item_kind: payload.item_kind as string,
      status: payload.status as string,
      label,
      summary,
      ...(providers.has(payload.provider as string)
        ? { provider: payload.provider as string }
        : {}),
      ...(detailKind ? { detail_kind: detailKind } : {}),
      ...(detailText ? { detail_text: detailText } : {}),
      ...(exitCode !== undefined ? { exit_code: exitCode } : {}),
    };
  }
  if (
    payload.kind === 'permission' &&
    permissionCategories.has(payload.category as string) &&
    permissionStatuses.has(payload.status as string)
  ) {
    const activityId = requiredString(payload.activity_id, 256);
    const summary = requiredString(payload.summary, 2_000);
    if (!activityId || !summary) return null;
    return {
      kind: 'permission',
      activity_id: activityId,
      category: payload.category as string,
      status: payload.status as string,
      ...(payload.decision === 'allowed' || payload.decision === 'denied'
        ? { decision: payload.decision }
        : {}),
      summary,
    };
  }
  if (payload.kind === 'usage') {
    const safeUsage: Record<string, unknown> = { kind: 'usage' };
    for (const key of [
      'input_tokens',
      'cached_input_tokens',
      'output_tokens',
      'total_cost_usd',
      'context_window_max_tokens',
      'context_window_used_tokens',
    ]) {
      if (typeof payload[key] === 'number' && Number.isFinite(payload[key]))
        safeUsage[key] = payload[key];
    }
    return safeUsage;
  }
  return null;
}

const detailKinds = new Set([
  'shell',
  'read',
  'write',
  'edit',
  'search',
  'fetch',
]);

function isDetailKind(value: unknown): value is string {
  return typeof value === 'string' && detailKinds.has(value);
}

function requiredString(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.length > 0
    ? value.slice(0, maxLength)
    : null;
}

function optionalString(
  value: unknown,
  maxLength = Number.POSITIVE_INFINITY,
): string | undefined {
  return typeof value === 'string' && value.length > 0
    ? value.slice(0, maxLength)
    : undefined;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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
