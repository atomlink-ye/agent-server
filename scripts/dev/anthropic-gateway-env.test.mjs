import { describe, expect, it } from 'vitest';

import {
  ANTHROPIC_GATEWAY_BASE_URL,
  ANTHROPIC_GATEWAY_DEFAULTS,
  ANTHROPIC_GATEWAY_ENVIRONMENT_NAMES,
  ANTHROPIC_GATEWAY_MODEL,
  clearAnthropicGatewayEnvironment,
  seedAnthropicGatewayEnvironment,
} from './anthropic-gateway-env.mjs';

describe('Anthropic gateway environment', () => {
  it('defines one base, model, and complete eight-variable provider surface', () => {
    expect(ANTHROPIC_GATEWAY_BASE_URL).toBe('https://opencode.ai/zen/go');
    expect(ANTHROPIC_GATEWAY_BASE_URL).not.toContain('/v1');
    expect(ANTHROPIC_GATEWAY_MODEL).toBe('deepseek-v4-flash');
    expect(ANTHROPIC_GATEWAY_ENVIRONMENT_NAMES).toHaveLength(8);
    expect(ANTHROPIC_GATEWAY_ENVIRONMENT_NAMES).toContain('ANTHROPIC_API_KEY');
    expect(Object.values(ANTHROPIC_GATEWAY_DEFAULTS)).toEqual([
      ANTHROPIC_GATEWAY_BASE_URL,
      ANTHROPIC_GATEWAY_MODEL,
      ANTHROPIC_GATEWAY_MODEL,
      ANTHROPIC_GATEWAY_MODEL,
      ANTHROPIC_GATEWAY_MODEL,
      ANTHROPIC_GATEWAY_MODEL,
      ANTHROPIC_GATEWAY_MODEL,
    ]);
  });

  it('seeds the Anthropic key from OPENCODE and preserves explicit defaults', () => {
    const environment = {
      OPENCODE_GO_API_KEY: '  gateway-secret  ',
      ANTHROPIC_MODEL: 'custom-model',
    };

    seedAnthropicGatewayEnvironment(environment);

    expect(environment).toMatchObject({
      ANTHROPIC_BASE_URL: ANTHROPIC_GATEWAY_BASE_URL,
      ANTHROPIC_API_KEY: 'gateway-secret',
      ANTHROPIC_MODEL: 'custom-model',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: ANTHROPIC_GATEWAY_MODEL,
      ANTHROPIC_DEFAULT_SONNET_MODEL: ANTHROPIC_GATEWAY_MODEL,
      ANTHROPIC_DEFAULT_OPUS_MODEL: ANTHROPIC_GATEWAY_MODEL,
      ANTHROPIC_SMALL_FAST_MODEL: ANTHROPIC_GATEWAY_MODEL,
      CLAUDE_CODE_SUBAGENT_MODEL: ANTHROPIC_GATEWAY_MODEL,
    });
  });

  it('removes every Anthropic provider variable for omit-auth mode', () => {
    const environment = Object.fromEntries(
      ANTHROPIC_GATEWAY_ENVIRONMENT_NAMES.map((name) => [name, 'secret']),
    );

    clearAnthropicGatewayEnvironment(environment);

    expect(environment).toEqual({});
  });

  it('force-pins smoke defaults while sourcing the key from OPENCODE', () => {
    const environment = {
      OPENCODE_GO_API_KEY: 'gateway-secret',
      ANTHROPIC_BASE_URL: 'https://other.invalid',
      ANTHROPIC_API_KEY: 'other-secret',
      ANTHROPIC_MODEL: 'other-model',
    };

    seedAnthropicGatewayEnvironment(environment, { forcePinned: true });

    expect(environment).toMatchObject({
      ANTHROPIC_BASE_URL: ANTHROPIC_GATEWAY_BASE_URL,
      ANTHROPIC_API_KEY: 'gateway-secret',
      ANTHROPIC_MODEL: ANTHROPIC_GATEWAY_MODEL,
    });
  });
});
