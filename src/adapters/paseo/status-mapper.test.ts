import { describe, expect, it } from 'vitest';

import {
  isClaudeAuthenticationFailure,
  mapPaseoFinishStatus,
} from './status-mapper.js';

describe('mapPaseoFinishStatus', () => {
  it.each([
    ['idle', 'succeeded'],
    ['error', 'failed'],
    ['permission', 'failed'],
    ['timeout', 'timed_out'],
  ] as const)('maps %s to %s', (input, expected) => {
    expect(mapPaseoFinishStatus(input)).toBe(expected);
  });
});

describe('isClaudeAuthenticationFailure', () => {
  const base = {
    provider: 'claude',
    status: 'idle' as const,
    error: null,
    lastMessage: 'Not logged in · Please run /login',
  };

  it('recognizes the exact Claude authentication sentinel', () => {
    expect(isClaudeAuthenticationFailure(base)).toBe(true);
    expect(
      isClaudeAuthenticationFailure({
        ...base,
        lastMessage: '  Not logged in · Please run /login  ',
      }),
    ).toBe(true);
  });

  it.each([
    { provider: 'opencode', lastMessage: base.lastMessage },
    {
      provider: 'claude',
      status: 'error' as const,
      lastMessage: base.lastMessage,
    },
    {
      provider: 'claude',
      error: 'authentication failed',
      lastMessage: base.lastMessage,
    },
    { provider: 'claude', lastMessage: 'Not logged in' },
    { provider: 'claude', lastMessage: `x${base.lastMessage}` },
    { provider: 'claude', lastMessage: `${base.lastMessage} now` },
    { provider: 'claude', lastMessage: 'not logged in · Please run /login' },
    { provider: 'claude', lastMessage: 'Not logged in - Please run /login' },
  ])('rejects non-sentinel outcome %#', (variant) => {
    expect(isClaudeAuthenticationFailure({ ...base, ...variant })).toBe(false);
  });
});
