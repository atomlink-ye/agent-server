import { describe, expect, it } from 'vitest';

import { COLLABORATION_LIMITS } from './collaboration-policy-definition.js';

describe('collaboration policy defaults', () => {
  it('keeps one bounded MVE policy for work, attempts, dependencies and mailbox coalescing', () => {
    expect(COLLABORATION_LIMITS).toEqual({
      maxLeadTurns: 8,
      maxWorkItems: 4,
      maxAttemptsPerItem: 2,
      maxDependenciesPerWorkItem: 4,
      maxMessagesPerActivation: 8,
    });
  });
});
