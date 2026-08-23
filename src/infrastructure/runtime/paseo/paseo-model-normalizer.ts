import type { ManagedEnvironmentProvider } from '../../../domain/environments/managed-environment-package.js';

const OPENCODE_GO_PREFIX = 'opencode-go/';

/** Paseo's Claude/Codex launch path expects the gateway model without this prefix. */
export function normalizePaseoRequestedModel(
  provider: ManagedEnvironmentProvider,
  model: string,
): string {
  const stripsProviderPrefix = provider === 'claude' || provider === 'codex';
  return stripsProviderPrefix && model.startsWith(OPENCODE_GO_PREFIX)
    ? model.slice(OPENCODE_GO_PREFIX.length)
    : model;
}
