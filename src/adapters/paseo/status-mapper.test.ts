import { describe, expect, it } from 'vitest';

import {
  hasPositiveModelUsage,
  mapPaseoFinishStatus,
} from './status-mapper.js';

describe('mapPaseoFinishStatus', () => {
  it.each([
    ['idle', 'idle'],
    ['error', 'failed'],
    ['permission', 'failed'],
    ['timeout', 'timed_out'],
  ] as const)('maps %s to %s', (input, expected) => {
    expect(mapPaseoFinishStatus(input)).toBe(expected);
  });
});

describe('hasPositiveModelUsage', () => {
  it.each([
    { inputTokens: 1 },
    { outputTokens: 1 },
    { inputTokens: 1, outputTokens: 1 },
  ])('accepts positive model usage %#', (usage) => {
    expect(hasPositiveModelUsage(usage)).toBe(true);
  });

  it.each([
    undefined,
    null,
    {},
    { inputTokens: 0, outputTokens: 0 },
    { inputTokens: -1, outputTokens: -1 },
    { inputTokens: Number.NaN, outputTokens: Number.NaN },
    { inputTokens: Number.POSITIVE_INFINITY },
    { outputTokens: Number.NEGATIVE_INFINITY },
    { totalCostUsd: 1 },
  ])('rejects missing or non-positive model usage %#', (usage) => {
    expect(hasPositiveModelUsage(usage)).toBe(false);
  });
});
