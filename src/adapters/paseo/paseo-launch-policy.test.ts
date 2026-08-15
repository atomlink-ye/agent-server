import { describe, expect, it } from 'vitest';

import { resolvePaseoCompatibilityLaunchPolicy } from './paseo-launch-policy.js';

describe('resolvePaseoCompatibilityLaunchPolicy', () => {
  it.each([
    ['opencode', 'build'],
    ['claude', 'bypassPermissions'],
    ['codex', 'full-access'],
  ] as const)('keeps %s provider-native mode in the Paseo compatibility seam', (provider, mode) => {
    expect(resolvePaseoCompatibilityLaunchPolicy(provider)).toEqual({ mode });
  });
});
