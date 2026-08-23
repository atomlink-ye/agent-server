import { ProductRunTraceSuccessSchema } from '@atomlink-ye/agent-server/product-contract';
import {
  normalizeProductRunTrace,
  type NormalizedTrace,
} from '@/features/run-trace/normalized';

export type AnchoredRecordingTrace = NormalizedTrace;

type Recording = {
  readonly recording_documents: readonly unknown[];
};

/** Parse a stable fixture trace through the accepted product contract. */
export function parseRecordedTrace(
  recording: Recording,
): AnchoredRecordingTrace {
  return normalizeProductRunTrace(
    ProductRunTraceSuccessSchema.parse(recording.recording_documents[0]),
  );
}
