import type { ManagedEnvironmentProvider } from '../../domain/environments/managed-environment-package.js';

/**
 * Compatibility shim for the pinned Paseo 0.1.x SDK, which still requires a
 * provider-native mode at Agent creation. This is not a provider adapter and
 * must disappear when the supported Paseo SDK can resolve its own launch mode.
 */
export interface PaseoCompatibilityLaunchPolicy {
  readonly mode: string;
}

export function resolvePaseoCompatibilityLaunchPolicy(
  provider: ManagedEnvironmentProvider,
): PaseoCompatibilityLaunchPolicy {
  switch (provider) {
    case 'opencode':
      return { mode: 'build' };
    case 'claude':
      return { mode: 'bypassPermissions' };
    case 'codex':
      return { mode: 'full-access' };
    default:
      return assertNever(provider);
  }
}

function assertNever(provider: never): never {
  throw new Error(`Unsupported Paseo provider: ${String(provider)}`);
}
