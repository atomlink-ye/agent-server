import { describe, expect, it } from 'vitest';

import { compatibilityRuntimeSessionPolicy } from './runtime-session-policy.js';

describe('compatibilityRuntimeSessionPolicy', () => {
  it.each([
    ['product_session', 'sticky'],
    ['team_member', 'sticky'],
    ['task', 'fresh'],
  ] as const)('maps %s to %s without changing current reuse behavior', (scope, policy) => {
    expect(compatibilityRuntimeSessionPolicy(scope)).toBe(policy);
  });
});
