import { describe, expect, it } from 'vitest';

import {
  assertRunTransition,
  canTransitionRun,
  InvalidRunTransitionError,
  terminalRunStatuses,
} from './run-status.js';

describe('run status', () => {
  it('allows the baseline success path', () => {
    expect(canTransitionRun('queued', 'running')).toBe(true);
    expect(canTransitionRun('running', 'succeeded')).toBe(true);
  });

  it('allows explicit failure and timeout outcomes', () => {
    expect(canTransitionRun('running', 'failed')).toBe(true);
    expect(canTransitionRun('running', 'timed_out')).toBe(true);
  });

  it('keeps terminal history immutable', () => {
    for (const status of terminalRunStatuses) {
      expect(() => assertRunTransition(status, 'running')).toThrow(
        InvalidRunTransitionError,
      );
    }
  });
});
