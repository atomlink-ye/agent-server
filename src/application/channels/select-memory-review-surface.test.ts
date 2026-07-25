import { describe, expect, it } from 'vitest';

import { selectMemoryReviewSurface } from './select-memory-review-surface.js';

describe('selectMemoryReviewSurface', () => {
  it('selects a card only when both short thresholds are met', () => {
    expect(selectMemoryReviewSurface({ content: 'x'.repeat(1500) }).mode).toBe(
      'card',
    );
    expect(
      selectMemoryReviewSurface({
        content: Array.from({ length: 20 }, () => 'x').join('\n'),
      }).mode,
    ).toBe('card');
    expect(selectMemoryReviewSurface({ content: 'x'.repeat(1501) }).mode).toBe(
      'card_with_doc',
    );
    expect(
      selectMemoryReviewSurface({
        content: Array.from({ length: 21 }, () => 'x').join('\n'),
      }).mode,
    ).toBe('card_with_doc');
  });

  it('selects command-only when card delivery is unavailable', () => {
    expect(
      selectMemoryReviewSurface({
        content: 'short',
        cardDeliveryAvailable: false,
      }),
    ).toEqual({ mode: 'command_only', commandOnlyFallback: true });
  });
});
