import 'server-only';

export type SafeRunEvent = {
  readonly sequence: number;
  readonly type: string;
  readonly payload?: Readonly<Record<string, unknown>>;
};

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
    return { sequence: sequence as number, type };
  if (type !== 'output')
    return { sequence: sequence as number, type: 'output' };

  const payload = record(event.payload);
  const safePayload = safeOutputPayload(payload, sequence as number);
  return safePayload
    ? { sequence: sequence as number, type, payload: safePayload }
    : { sequence: sequence as number, type };
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
  sequence: number,
): Readonly<Record<string, unknown>> | null {
  if (!payload || typeof payload.kind !== 'string') return null;
  if (payload.kind === 'assistant_text')
    return { kind: 'assistant_text', text: 'Response updated.' };
  if (
    payload.kind === 'reasoning_progress' &&
    (payload.status === 'started' || payload.status === 'completed')
  )
    return { kind: 'reasoning_progress', status: payload.status };
  if (
    payload.kind === 'tool_status' &&
    toolCategories.has(String(payload.category)) &&
    toolStatuses.has(String(payload.status))
  ) {
    const category = String(payload.category);
    const status = String(payload.status);
    return {
      kind: 'tool_status',
      activity_id: `activity-${sequence}`,
      category,
      status,
      label: toolLabel(category),
      summary: activitySummary(status),
    };
  }
  if (
    payload.kind === 'permission' &&
    permissionCategories.has(String(payload.category)) &&
    permissionStatuses.has(String(payload.status))
  ) {
    const status = String(payload.status);
    return {
      kind: 'permission',
      activity_id: `permission-${sequence}`,
      category: String(payload.category),
      status,
      ...(payload.decision === 'allowed' || payload.decision === 'denied'
        ? { decision: payload.decision }
        : {}),
      summary:
        status === 'requested' ? 'Review requested.' : 'Review resolved.',
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

function toolLabel(category: string): string {
  return (
    {
      shell: 'Shell activity',
      read: 'Read activity',
      edit: 'Edit activity',
      write: 'Write activity',
      search: 'Workspace search',
      fetch: 'Fetch activity',
      subagent: 'Sub-agent task',
      other: 'Tool activity',
    }[category] ?? 'Tool activity'
  );
}

function activitySummary(status: string): string {
  return status === 'running'
    ? 'In progress.'
    : status === 'completed'
      ? 'Completed.'
      : status === 'failed'
        ? 'Did not complete.'
        : 'Cancelled.';
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
