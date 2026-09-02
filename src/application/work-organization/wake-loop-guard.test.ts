import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WAKE_LOOP_HARD_CAP,
  decideWakeLoopGuard,
} from './wake-loop-guard.js';

describe('decideWakeLoopGuard', () => {
  it('allows a WorkItem that has not yet reached the hard cap', () => {
    const decision = decideWakeLoopGuard({ agentWakeCount: 1 });
    expect(decision).toEqual({ kind: 'allow' });
  });

  it('allows exactly at the hard cap boundary', () => {
    const decision = decideWakeLoopGuard({
      agentWakeCount: DEFAULT_WAKE_LOOP_HARD_CAP,
    });
    expect(decision).toEqual({ kind: 'allow' });
  });

  it('blocks once the agent-caused wake count exceeds the hard cap', () => {
    const decision = decideWakeLoopGuard({
      agentWakeCount: DEFAULT_WAKE_LOOP_HARD_CAP + 1,
    });
    expect(decision).toEqual({
      kind: 'block',
      reason: 'hard_loop_cap',
      agentWakeCount: DEFAULT_WAKE_LOOP_HARD_CAP + 1,
      hardCap: DEFAULT_WAKE_LOOP_HARD_CAP,
    });
  });

  it('honors a caller-supplied hard cap instead of the default', () => {
    expect(decideWakeLoopGuard({ agentWakeCount: 3 }, { hardCap: 3 })).toEqual({
      kind: 'allow',
    });
    expect(decideWakeLoopGuard({ agentWakeCount: 4 }, { hardCap: 3 })).toEqual({
      kind: 'block',
      reason: 'hard_loop_cap',
      agentWakeCount: 4,
      hardCap: 3,
    });
  });
});
