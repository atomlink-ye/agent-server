import { describe, expect, it } from 'vitest';

import { DEFAULT_LOOP_HARD_CAP, decideLoopCap } from './loop-cap-guard.js';

describe('decideLoopCap', () => {
  it('allows a count that has not yet reached the hard cap', () => {
    expect(decideLoopCap({ count: 1 })).toEqual({ kind: 'allow' });
  });

  it('allows exactly at the hard cap boundary', () => {
    expect(decideLoopCap({ count: DEFAULT_LOOP_HARD_CAP })).toEqual({
      kind: 'allow',
    });
  });

  it('blocks once the count exceeds the hard cap', () => {
    expect(decideLoopCap({ count: DEFAULT_LOOP_HARD_CAP + 1 })).toEqual({
      kind: 'block',
      reason: 'hard_loop_cap',
      count: DEFAULT_LOOP_HARD_CAP + 1,
      hardCap: DEFAULT_LOOP_HARD_CAP,
    });
  });

  it('honors a caller-supplied hard cap instead of the default', () => {
    expect(decideLoopCap({ count: 3 }, { hardCap: 3 })).toEqual({
      kind: 'allow',
    });
    expect(decideLoopCap({ count: 4 }, { hardCap: 3 })).toEqual({
      kind: 'block',
      reason: 'hard_loop_cap',
      count: 4,
      hardCap: 3,
    });
  });
});
