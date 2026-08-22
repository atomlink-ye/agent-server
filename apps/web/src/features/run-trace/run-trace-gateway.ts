import type {
  ProductExecutionDetailEvent,
  ProductExecutionDetailResponse,
} from '@atomlink-ye/agent-server/product-contract';
import {
  ProductExecutionDetailResponseSchema,
  ProductSessionTranscriptsResponseSchema,
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
export type SessionEntry = ProductExecutionDetailEvent & {
  readonly ordinal: number;
};
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
  const value = await request(
    `/api/works/${encodeURIComponent(workId)}/runs/${encodeURIComponent(runId)}/execution-detail?attempt_id=${encodeURIComponent(attemptId)}`,
  );
  try {
    const detail = ProductExecutionDetailResponseSchema.parse(value);
    if (
      detail.work_id !== workId ||
      detail.work_run_id !== runId ||
      detail.attempt_id !== attemptId
    )
      throw new Error('identity mismatch');
    return detail;
  } catch {
    throw new RunTraceReadError('Captured execution detail was invalid.', 502);
  }
}

export async function loadSessionTranscripts(
  workId: string,
  runId: string,
): Promise<SessionTranscriptsResponse> {
  const value = await request(
    `/api/works/${encodeURIComponent(workId)}/runs/${encodeURIComponent(runId)}/session-transcripts`,
  );
  try {
    const transcripts = ProductSessionTranscriptsResponseSchema.parse(value);
    if (transcripts.work_id !== workId || transcripts.work_run_id !== runId)
      throw new Error('identity mismatch');
    return transcripts;
  } catch {
    throw new RunTraceReadError(
      'Captured session transcripts were invalid.',
      502,
    );
  }
}

export class RunTraceReadError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'RunTraceReadError';
  }
}

async function request(path: string): Promise<unknown> {
  try {
    return await apiTransport.request(path, {
      method: 'GET',
      cache: 'no-store',
    });
  } catch (error) {
    if (error instanceof ApiTransportError) {
      throw new RunTraceReadError(error.message, error.status);
    }
    throw error;
  }
}
