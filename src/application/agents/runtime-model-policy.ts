import {
  isModelPolicyRef,
  type ModelPolicyRef,
} from '../../domain/agents/managed-agent-package.js';

/**
 * An operator-pinned provider/model selection for a non-default policy.
 * `free-only` deliberately has no value here: it uses the process fallback.
 */
export type RuntimeModelPolicy = Readonly<{
  readonly provider: 'claude' | 'codex';
  readonly model: 'deepseek-v4-flash';
}>;

const CLAUDE_DEEPSEEK_V4_FLASH = Object.freeze({
  provider: 'claude',
  model: 'deepseek-v4-flash',
} satisfies RuntimeModelPolicy);
const CODEX_DEEPSEEK_V4_FLASH = Object.freeze({
  provider: 'codex',
  model: 'deepseek-v4-flash',
} satisfies RuntimeModelPolicy);

/**
 * Resolve a persisted model-policy reference to an explicit runtime choice.
 * `free-only` returns null so callers retain their process-configured fallback.
 * Values outside the closed policy set throw rather than silently selecting
 * that fallback.
 */
export function resolveRuntimeModelPolicy(
  ref: unknown,
): RuntimeModelPolicy | null {
  if (!isModelPolicyRef(ref)) {
    throw new Error('Unsupported model policy reference.');
  }

  switch (ref as ModelPolicyRef) {
    case 'free-only':
      return null;
    case 'claude/deepseek-v4-flash':
      return CLAUDE_DEEPSEEK_V4_FLASH;
    case 'codex/deepseek-v4-flash':
      return CODEX_DEEPSEEK_V4_FLASH;
  }
}
