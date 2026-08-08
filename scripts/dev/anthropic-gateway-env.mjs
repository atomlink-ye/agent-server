export const ANTHROPIC_GATEWAY_BASE_URL = 'https://opencode.ai/zen/go';
export const ANTHROPIC_GATEWAY_MODEL = 'deepseek-v4-flash';

export const ANTHROPIC_GATEWAY_ENVIRONMENT_NAMES = Object.freeze([
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL',
]);

export const ANTHROPIC_GATEWAY_DEFAULTS = Object.freeze({
  ANTHROPIC_BASE_URL: ANTHROPIC_GATEWAY_BASE_URL,
  ANTHROPIC_MODEL: ANTHROPIC_GATEWAY_MODEL,
  ANTHROPIC_DEFAULT_HAIKU_MODEL: ANTHROPIC_GATEWAY_MODEL,
  ANTHROPIC_DEFAULT_SONNET_MODEL: ANTHROPIC_GATEWAY_MODEL,
  ANTHROPIC_DEFAULT_OPUS_MODEL: ANTHROPIC_GATEWAY_MODEL,
  ANTHROPIC_SMALL_FAST_MODEL: ANTHROPIC_GATEWAY_MODEL,
  CLAUDE_CODE_SUBAGENT_MODEL: ANTHROPIC_GATEWAY_MODEL,
});

export function seedAnthropicGatewayEnvironment(
  environment,
  { forcePinned = false } = {},
) {
  const apiKey = environment.OPENCODE_GO_API_KEY?.trim();
  if (!apiKey) return environment;

  for (const [name, value] of Object.entries(ANTHROPIC_GATEWAY_DEFAULTS)) {
    if (forcePinned || !environment[name]?.trim()) environment[name] = value;
  }
  environment.ANTHROPIC_API_KEY = apiKey;
  return environment;
}

export function clearAnthropicGatewayEnvironment(environment) {
  for (const name of ANTHROPIC_GATEWAY_ENVIRONMENT_NAMES)
    delete environment[name];
  return environment;
}
