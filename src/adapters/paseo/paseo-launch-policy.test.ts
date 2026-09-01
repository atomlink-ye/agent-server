import { describe, expect, it } from 'vitest';

import { resolvePaseoCompatibilityLaunchPolicy } from './paseo-launch-policy.js';

describe('resolvePaseoCompatibilityLaunchPolicy', () => {
  it.each([
    ['opencode', 'build'],
    ['claude', 'auto'],
    ['codex', 'full-access'],
  ] as const)(
    'keeps %s provider-native mode in the Paseo compatibility seam',
    (provider, mode) => {
      expect(resolvePaseoCompatibilityLaunchPolicy(provider, {})).toEqual({
        mode,
      });
    },
  );

  it('keeps Claude auto mode on an Anthropic-compatible gateway', () => {
    expect(
      resolvePaseoCompatibilityLaunchPolicy('claude', {
        ANTHROPIC_BASE_URL: 'https://opencode.ai/zen/go',
        ANTHROPIC_API_KEY: 'gateway-key',
      }),
    ).toEqual({ mode: 'auto' });
  });

  it('replaces Claude auto mode when Claude Code uses Bedrock', () => {
    expect(
      resolvePaseoCompatibilityLaunchPolicy('claude', {
        CLAUDE_CODE_USE_BEDROCK: '1',
      }),
    ).toEqual({ mode: 'bypassPermissions' });
  });

  it('replaces Claude auto mode when Claude Code uses Vertex', () => {
    expect(
      resolvePaseoCompatibilityLaunchPolicy('claude', {
        CLAUDE_CODE_USE_VERTEX: '1',
      }),
    ).toEqual({ mode: 'bypassPermissions' });
  });

  it.each(['opencode', 'codex'] as const)(
    'leaves the %s mode unchanged under Bedrock',
    (provider) => {
      expect(
        resolvePaseoCompatibilityLaunchPolicy(provider, {
          CLAUDE_CODE_USE_BEDROCK: '1',
        }),
      ).toEqual(resolvePaseoCompatibilityLaunchPolicy(provider, {}));
    },
  );
});
