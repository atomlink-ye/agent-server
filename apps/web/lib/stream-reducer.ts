export type RunStreamEvent = {
  readonly sequence: number;
  readonly type: string;
  readonly payload?: unknown;
};

export type StreamProjection = {
  readonly lastSequence: number;
  readonly assistantText: string | null;
  readonly terminal: 'succeeded' | 'failed' | 'cancelled' | null;
};

export const initialStreamProjection: StreamProjection = {
  lastSequence: 0,
  assistantText: null,
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
  const next: StreamProjection = {
    ...state,
    lastSequence: event.sequence,
  };
  if (
    event.type === 'succeeded' ||
    event.type === 'failed' ||
    event.type === 'cancelled'
  )
    return { ...next, terminal: event.type };
  if (event.type !== 'output') return next;
  const payload = asRecord(event.payload);
  if (payload?.kind !== 'assistant_text' || typeof payload.text !== 'string')
    return next;
  return { ...next, assistantText: payload.text };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
