import { describe, expect, it } from 'vitest';
import { memoryReviewDecisionFingerprint } from './memory-review-fingerprint.js';

describe('memoryReviewDecisionFingerprint', () => {
  it('uses fixed-key canonical JSON and preserves edit bytes exactly', () => {
    expect(
      memoryReviewDecisionFingerprint({ action: 'accept', content: null }),
    ).toBe('af2653065e9db8c9592e836a09cac6b441158810d26f49fcf9962c04a10796a7');
    expect(
      memoryReviewDecisionFingerprint({
        action: 'edit_and_accept',
        content: ' x ',
      }),
    ).not.toBe(
      memoryReviewDecisionFingerprint({
        action: 'edit_and_accept',
        content: 'x',
      }),
    );
  });
});
