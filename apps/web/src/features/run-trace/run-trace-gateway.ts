import type {
  ProductExecutionDetailEvent,
  ProductExecutionDetailResponse,
} from '@atomlink-ye/agent-server/product-contract';

import { apiTransport, ApiTransportError } from '../../api/transport';

export type SessionLabel = {
  readonly name: string;
  readonly role: string;
  readonly status: string;
};
export type SessionMeaningful = {
  readonly kind: string;
  readonly timestamp: string;
  readonly action: string | null;
  readonly result: string | null;
};
export type SessionSummary = {
  readonly status: string;
  readonly entry_count: number;
  readonly last_timestamp: string | null;
  readonly last_meaningful: SessionMeaningful | null;
  readonly work_refs: readonly string[];
  readonly truncated: boolean;
};
export type SessionEntry = ProductExecutionDetailEvent & { readonly ordinal: number };
export type Session = {
  readonly label: SessionLabel;
  readonly summary: SessionSummary;
  readonly entries: readonly SessionEntry[];
};
export type SessionTranscriptsResponse = {
  readonly work_id: string;
  readonly work_run_id: string;
  readonly capture_scope: string;
  readonly sessions: readonly Session[];
};

export async function loadExecutionDetail(
  workId: string,
  runId: string,
  attemptId: string,
): Promise<ProductExecutionDetailResponse> {
  const value = await request<unknown>(
    `/api/works/${encodeURIComponent(workId)}/runs/${encodeURIComponent(runId)}/execution-detail?attempt_id=${encodeURIComponent(attemptId)}`,
  );
  if (!isExecutionDetail(value)) {
    throw new RunTraceReadError('Captured execution detail was invalid.', 502);
  }
  return value;
}

export async function loadSessionTranscripts(
  workId: string,
  runId: string,
): Promise<SessionTranscriptsResponse> {
  const value = await request<unknown>(
    `/api/works/${encodeURIComponent(workId)}/runs/${encodeURIComponent(runId)}/session-transcripts`,
  );
  if (!isSessionTranscripts(value)) {
    throw new RunTraceReadError('Captured session transcripts were invalid.', 502);
  }
  return value;
}

export class RunTraceReadError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'RunTraceReadError';
  }
}

async function request<T>(path: string): Promise<T> {
  try {
    return await apiTransport.request<T>(path, { method: 'GET', cache: 'no-store' });
  } catch (error) {
    if (error instanceof ApiTransportError) {
      throw new RunTraceReadError(error.message, error.status);
    }
    throw error;
  }
}

function isExecutionDetail(value: unknown): value is ProductExecutionDetailResponse {
  const root = record(value);
  return root?.capture_scope === 'safe_run_events' && Array.isArray(root.events);
}

function isSessionTranscripts(value: unknown): value is SessionTranscriptsResponse {
  const root = record(value);
  return (
    typeof root?.work_id === 'string' &&
    typeof root.work_run_id === 'string' &&
    root.capture_scope === 'safe_run_events' &&
    Array.isArray(root.sessions) &&
    root.sessions.every(isSession)
  );
}

function isSession(value: unknown): value is Session {
  const root = record(value);
  const label = record(root?.label);
  const summary = record(root?.summary);
  return (
    typeof label?.name === 'string' &&
    typeof label.role === 'string' &&
    typeof label.status === 'string' &&
    typeof summary?.status === 'string' &&
    Number.isSafeInteger(summary.entry_count) &&
    (summary.last_timestamp === null || typeof summary.last_timestamp === 'string') &&
    (summary.last_meaningful === null || record(summary.last_meaningful) !== null) &&
    Array.isArray(summary.work_refs) &&
    summary.work_refs.every((item) => typeof item === 'string') &&
    typeof summary.truncated === 'boolean' &&
    Array.isArray(root.entries)
  );
}

function record(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
}
