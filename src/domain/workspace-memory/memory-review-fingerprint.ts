import { createHash } from 'node:crypto';
import type { MemoryReviewOutcome } from './memory-proposal.js';

export function memoryReviewDecisionFingerprint(input: {
  readonly action: MemoryReviewOutcome;
  readonly content: string | null;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        action: input.action,
        content: input.content,
      }),
      'utf8',
    )
    .digest('hex');
}
