import { describe, expect, it } from 'vitest';

import { mapPaseoFinishStatus } from './status-mapper.js';

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
