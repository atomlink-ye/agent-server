import {
  ProductWorkRunDetailSchema,
  WorkListItemSchema,
  WorkListResponseSchema,
  WorkResponseSchema,
  WorkRunListResponseSchema,
  WorkRunSummarySchema,
  type WorkListResponse,
  type WorkRunListResponse,
} from '@atomlink-ye/agent-server/product-contract';

export type ProductRecording = {
  readonly recording_documents: readonly unknown[];
};

type RecordingWorkResponse = ReturnType<typeof WorkResponseSchema.parse>;
type RecordingWorkRunDetail = ReturnType<
  typeof ProductWorkRunDetailSchema.parse
>;

const WORK_RUN_SUMMARY_KEYS = [
  'id',
  'work_id',
  'definition_version_id',
  'trigger_kind',
  'trigger_ref',
  'expires_at',
  'bound_at',
  'created_at',
  'updated_at',
] as const;

function recordingDocuments(recording: ProductRecording): readonly unknown[] {
  if (!Array.isArray(recording.recording_documents))
    throw new Error('recording_documents_missing');
  if (recording.recording_documents.length < 3)
    throw new Error('recording_documents_incomplete');
  return recording.recording_documents;
}

function workFromRecording(recording: ProductRecording): RecordingWorkResponse {
  const documents = recordingDocuments(recording);
  return WorkResponseSchema.parse(documents[2]);
}

function workRunFromRecording(
  recording: ProductRecording,
): RecordingWorkRunDetail {
  const documents = recordingDocuments(recording);
  return ProductWorkRunDetailSchema.parse(documents[1]);
}

function workRunSummary(detail: RecordingWorkRunDetail) {
  const summary = Object.fromEntries(
    WORK_RUN_SUMMARY_KEYS.map((key) => [key, detail[key]]),
  );
  return WorkRunSummarySchema.parse(summary);
}

/**
 * Project recorded Product responses for browser-test fixtures. No list data
 * is synthesized: all fields originate in documents [2] or [1], and the
 * accepted list contract supplies only the required `next_cursor: null`
 * pagination terminator.
 */
export function projectWorkList(recording: ProductRecording): WorkListResponse {
  const work = workFromRecording(recording);
  const detail = workRunFromRecording(recording);
  const latestRun = workRunSummary(detail);
  const item = WorkListItemSchema.parse({
    ...work,
    product_state: detail.product_state,
    latest_run_summary: {
      id: latestRun.id,
      updated_at: latestRun.updated_at,
      result_summary: detail.result_summary,
      result_capture_status: detail.result_capture_status,
    },
  });
  return WorkListResponseSchema.parse({
    works: [item],
    next_cursor: null,
  });
}

/**
 * Project the recorded WorkRunResponse into GET /works/{id}/runs. A foreign
 * work id has no recorded run and therefore produces the contract's empty
 * page; it is never filled with a run from another recording.
 */
export function projectWorkRunList(
  recording: ProductRecording,
  workId?: string,
): WorkRunListResponse {
  const detail = workRunFromRecording(recording);
  const summary = workRunSummary(detail);
  const workRuns =
    workId === undefined || workId === summary.work_id ? [summary] : [];
  return WorkRunListResponseSchema.parse({
    work_runs: workRuns,
    next_cursor: null,
  });
}

export const projectWorkListResponse = projectWorkList;
export const projectWorkRunListResponse = projectWorkRunList;
export const projectWorksResponse = projectWorkList;
export const projectWorkRunsResponse = projectWorkRunList;
