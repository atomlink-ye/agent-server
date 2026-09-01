import type { ManagedEnvironmentProvider } from '../../domain/environments/managed-environment-package.js';
import { detectClaudeCodeTransport } from '../../shared/claude-code-transport.js';

/**
 * Compatibility shim for the pinned Paseo 0.1.x SDK, which still requires a
 * provider-native mode at Agent creation. This is not a provider adapter and
 * must disappear when the supported Paseo SDK can resolve its own launch mode.
 */
export interface PaseoCompatibilityLaunchPolicy {
  readonly mode: string;
}

/**
 * Claude's permission modes accepted by the pinned daemon are `plan`,
 * `default`, `acceptEdits`, `auto` and `bypassPermissions`.
 *
 * `auto` is the unattended default because it resolves permission prompts with
 * a model classifier, but it is implemented only on the Anthropic API. On a
 * non-Anthropic-API transport the daemon rejects Agent creation outright:
 *
 * > Claude Auto mode requires the Anthropic API and is not supported when
 * > Claude Code uses Bedrock. Select another permission mode or unset the
 * > CLAUDE_CODE_USE_BEDROCK environment variable.
 *
 * `bypassPermissions` is the transport-independent mode that still runs
 * unattended: `plan` cannot edit, and `default`/`acceptEdits` block on
 * permission prompts no human is present to answer.
 */
const CLAUDE_MODE_BY_TRANSPORT = {
  anthropic_api: 'auto',
  bedrock: 'bypassPermissions',
  vertex: 'bypassPermissions',
} as const;

export function resolvePaseoCompatibilityLaunchPolicy(
  provider: ManagedEnvironmentProvider,
  environment: NodeJS.ProcessEnv = process.env,
): PaseoCompatibilityLaunchPolicy {
  switch (provider) {
    case 'opencode':
      return { mode: 'build' };
    case 'claude':
      return {
        mode: CLAUDE_MODE_BY_TRANSPORT[detectClaudeCodeTransport(environment)],
      };
    case 'codex':
      return { mode: 'full-access' };
    default:
      return assertNever(provider);
  }
}

function assertNever(provider: never): never {
  throw new Error(`Unsupported Paseo provider: ${String(provider)}`);
}
