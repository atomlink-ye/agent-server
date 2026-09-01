/**
 * How Claude Code reaches a model.
 *
 * Claude Code can talk to a model over three different transports, and they are
 * not interchangeable: some Claude permission modes exist only on the Anthropic
 * API. Naming the transport once keeps that difference explicit instead of
 * leaving each call site to re-derive it from an ad-hoc environment check.
 *
 * - `anthropic_api`: the Anthropic API itself, or an Anthropic-compatible
 *   gateway selected through `ANTHROPIC_BASE_URL` (the repository development
 *   default is the `opencode.ai/zen/go` gateway). Claude Code cannot tell those
 *   two apart, and neither can we, so they are one transport here.
 * - `bedrock`: AWS Bedrock, selected by `CLAUDE_CODE_USE_BEDROCK`.
 * - `vertex`: Google Vertex AI, selected by `CLAUDE_CODE_USE_VERTEX`.
 */
export type ClaudeCodeTransport = 'anthropic_api' | 'bedrock' | 'vertex';

/**
 * The environment variables that select and configure a non-Anthropic-API
 * transport. Runtime bootstrap scripts must forward these into the Paseo daemon
 * process, otherwise the daemon runs on the Anthropic API path while the caller
 * believes Bedrock is in use.
 */
export const CLAUDE_CODE_BEDROCK_ENVIRONMENT_NAMES = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_SKIP_BEDROCK_AUTH',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
] as const;

/**
 * Resolve the active transport from the process environment.
 *
 * Bedrock wins over Vertex when both flags are set, matching how Claude Code
 * and the Paseo daemon resolve the same two variables.
 */
export function detectClaudeCodeTransport(
  environment: NodeJS.ProcessEnv = process.env,
): ClaudeCodeTransport {
  if (isEnabledTransportFlag(environment.CLAUDE_CODE_USE_BEDROCK))
    return 'bedrock';
  if (isEnabledTransportFlag(environment.CLAUDE_CODE_USE_VERTEX))
    return 'vertex';
  return 'anthropic_api';
}

/**
 * Claude Code treats any non-empty value other than an explicit negation as
 * "enabled". This mirrors the daemon's own truthiness rule so Agent Server and
 * Paseo never disagree about which transport is active.
 */
function isEnabledTransportFlag(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return (
    normalized !== undefined &&
    normalized.length > 0 &&
    normalized !== '0' &&
    normalized !== 'false' &&
    normalized !== 'no' &&
    normalized !== 'off'
  );
}
