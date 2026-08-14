import {
  ProductRunTraceSuccessSchema,
  type ProductRunTrace,
} from '@atomlink-ye/agent-server/product-contract';

export type AnchoredRecordingTrace = Extract<
  ProductRunTrace,
  { projection_status: 'internally_anchored' }
>;

type Recording = {
  readonly recording_documents: readonly unknown[];
};

/** Parse a stable fixture trace through the accepted product contract. */
export function parseRecordedTrace(
  recording: Recording,
): AnchoredRecordingTrace {
  return ProductRunTraceSuccessSchema.parse(recording.recording_documents[0]);
}
