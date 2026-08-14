import {
  ProductRunTraceResponseSchema,
  type ProductRunTrace,
} from '@atomlink-ye/agent-server/product-contract';

export type AnchoredRecordingTrace = Extract<
  ProductRunTrace,
  { projection_status: 'internally_anchored' }
>;

type Recording = {
  readonly recording_documents: readonly unknown[];
};

/** Read the original recorder's trace document through the accepted schema. */
export function parseRecordedTrace(
  recording: Recording,
): AnchoredRecordingTrace {
  const parsed = ProductRunTraceResponseSchema.parse(
    recording.recording_documents[0],
  );
  if (parsed.projection_status !== 'internally_anchored')
    throw new Error('recording_trace_not_internally_anchored');
  return parsed;
}
