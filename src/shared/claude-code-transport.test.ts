import { describe, expect, it } from 'vitest';

import { detectClaudeCodeTransport } from './claude-code-transport.js';

describe('detectClaudeCodeTransport', () => {
  it('reports the Anthropic API transport when no override flag is present', () => {
    expect(detectClaudeCodeTransport({})).toBe('anthropic_api');
  });

  it('keeps the Anthropic API transport for a gateway base URL', () => {
    expect(
      detectClaudeCodeTransport({
        ANTHROPIC_BASE_URL: 'https://opencode.ai/zen/go',
        ANTHROPIC_API_KEY: 'gateway-key',
      }),
    ).toBe('anthropic_api');
  });

  it.each(['1', 'true', 'yes', 'on', 'anything'])(
    'reports Bedrock for CLAUDE_CODE_USE_BEDROCK=%s',
    (value) => {
      expect(
        detectClaudeCodeTransport({ CLAUDE_CODE_USE_BEDROCK: value }),
      ).toBe('bedrock');
    },
  );

  it.each(['', '  ', '0', 'false', 'FALSE', 'no', 'off'])(
    'ignores a disabled CLAUDE_CODE_USE_BEDROCK=%s',
    (value) => {
      expect(
        detectClaudeCodeTransport({ CLAUDE_CODE_USE_BEDROCK: value }),
      ).toBe('anthropic_api');
    },
  );

  it('reports Vertex for CLAUDE_CODE_USE_VERTEX', () => {
    expect(detectClaudeCodeTransport({ CLAUDE_CODE_USE_VERTEX: '1' })).toBe(
      'vertex',
    );
  });

  it('prefers Bedrock when both transport flags are enabled', () => {
    expect(
      detectClaudeCodeTransport({
        CLAUDE_CODE_USE_BEDROCK: '1',
        CLAUDE_CODE_USE_VERTEX: '1',
      }),
    ).toBe('bedrock');
  });
});
