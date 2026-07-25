import { describe, expect, it } from 'vitest';
import { createMemoryReviewActionTokenDeriver } from './memory-review-action-token.js';

describe('memory review action token derivation', () => {
  it('is stable, domain-separated, and base64url encoded', () => {
    const deriver = createMemoryReviewActionTokenDeriver('secret');
    const input = { surfaceId: 'surface-1', version: 1 };
    const first = deriver.derive(input);
    expect(first).toBe(deriver.derive(input));
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(
      createMemoryReviewActionTokenDeriver('other').derive(input),
    ).not.toBe(first);
    expect(deriver.derive({ surfaceId: 'surface-2', version: 1 })).not.toBe(
      first,
    );
    expect(deriver.derive({ surfaceId: 'surface-1', version: 2 })).not.toBe(
      first,
    );
  });
});
