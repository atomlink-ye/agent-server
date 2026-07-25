import { describe, expect, it } from 'vitest';
import { parseMemoryReviewCardPublicationDescriptor } from './lark-memory-review-card-publication.js';

const base = {
  type: 'lark_memory_review_card_v1',
  surfaceId: 'surface-1',
  version: 1,
  proposalId: 'proposal-1',
  bindingId: 'binding-1',
  owner: {
    tenantId: 'tenant',
    workspaceId: 'workspace',
    principalType: 'service_account',
    principalId: 'owner',
  },
  category: 'constraint',
  content: 'Keep it reversible.',
  source: 'Proposed by the completed agent task in this thread.',
};

describe('memory review Card publication descriptor', () => {
  it.each([
    ['zero version', { version: 0 }],
    ['fractional version', { version: 1.5 }],
    ['negative version', { version: -1 }],
    ['blank id', { surfaceId: '' }],
    ['oversized utf8 id', { surfaceId: '🙂'.repeat(129) }],
    ['oversized category', { category: 'x'.repeat(121) }],
    ['oversized source', { source: 'x'.repeat(257) }],
    ['long content', { content: 'x'.repeat(1501) }],
    ['too many lines', { content: 'x\n'.repeat(21) }],
  ])('rejects %s', (_label, change) => {
    expect(() =>
      parseMemoryReviewCardPublicationDescriptor({ ...base, ...change }),
    ).toThrow();
  });

  it('accepts exact bounds', () => {
    expect(
      parseMemoryReviewCardPublicationDescriptor({
        ...base,
        surfaceId: '🙂'.repeat(128),
        category: 'x'.repeat(120),
        source: 'x'.repeat(256),
        content: 'x'.repeat(1500),
      }),
    ).toMatchObject({ version: 1 });
  });
});
