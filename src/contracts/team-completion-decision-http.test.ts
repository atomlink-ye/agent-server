import { describe, expect, it } from 'vitest';

import { TeamCompletionDecisionRequestSchema } from './teams.js';

describe('team completion decision HTTP schema', () => {
  it('accepts only the approve discriminator fields', () => {
    expect(
      TeamCompletionDecisionRequestSchema.parse({
        decision: 'approve',
        expected_revision: 4,
      }),
    ).toEqual({ decision: 'approve', expected_revision: 4 });

    expect(() =>
      TeamCompletionDecisionRequestSchema.parse({
        decision: 'approve',
        expected_revision: 4,
        feedback: 'unexpected',
      }),
    ).toThrow();
  });

  it('requires bounded feedback and unique work item IDs for reject', () => {
    expect(() =>
      TeamCompletionDecisionRequestSchema.parse({
        decision: 'reject',
        expected_revision: 4,
        feedback: '   ',
        work_item_ids: ['00000000-0000-4000-8000-000000000001'],
      }),
    ).toThrow();
    expect(() =>
      TeamCompletionDecisionRequestSchema.parse({
        decision: 'reject',
        expected_revision: 4,
        feedback: 'Fix the source links.',
        work_item_ids: [
          '00000000-0000-4000-8000-000000000001',
          '00000000-0000-4000-8000-000000000001',
        ],
      }),
    ).toThrow();
  });
});
