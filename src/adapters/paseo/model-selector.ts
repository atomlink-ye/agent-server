import type { ManagedEnvironmentProvider } from '../../domain/environments/managed-environment-package.js';
import { RuntimeModelUnavailableError } from './errors.js';

export interface PaseoModelDescriptor {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  /** Paseo's own marker for the model a provider picks when none is requested. */
  readonly isDefault?: boolean;
  /**
   * False on the legacy-alias catalog entries Paseo publishes so that an
   * operator's older pinned id keeps resolving. They are answerable but must
   * never win an automatic choice.
   */
  readonly isSelectable?: boolean;
}

export const preferredFreeOpenCodeModels = [
  'opencode/deepseek-v4-flash-free',
  'opencode/north-mini-code-free',
  'opencode/nemotron-3-ultra-free',
  'opencode/hy3-free',
] as const;

/** Keeps an unavailable-model message useful without pasting a whole catalog. */
const REPORTED_MODEL_ID_LIMIT = 20;

export function isExplicitlyFreeModel(model: PaseoModelDescriptor): boolean {
  return (
    /(?:^|[-/])free(?:$|-)/i.test(model.id) ||
    /\bfree\b/i.test(model.label) ||
    (model.description !== undefined && /\bfree\b/i.test(model.description))
  );
}

/**
 * Resolve the model a Paseo connection runs on.
 *
 * An operator-pinned model is honoured for every provider and must exist in the
 * catalog Paseo reports. Without one, only OpenCode is held to the `free-only`
 * cost policy: its gateway is the one that actually marks models free or paid,
 * so the filter is a real guard there. Providers that report no such marker --
 * Claude and Codex reach a subscription, not a per-token gateway -- fall back to
 * Paseo's own rule, the catalog's default entry.
 */
export function selectRuntimeModel(input: {
  readonly provider: ManagedEnvironmentProvider;
  readonly models: readonly PaseoModelDescriptor[];
  readonly requestedModel?: string;
}): PaseoModelDescriptor {
  const { provider, models, requestedModel } = input;
  if (requestedModel)
    return requirePinnedModel(provider, models, requestedModel);
  return provider === 'opencode'
    ? selectFreeOpenCodeModel(models)
    : selectProviderDefaultModel(provider, models);
}

function requirePinnedModel(
  provider: ManagedEnvironmentProvider,
  models: readonly PaseoModelDescriptor[],
  requestedModel: string,
): PaseoModelDescriptor {
  const requested = models.find((model) => model.id === requestedModel);
  if (requested) return requested;
  throw new RuntimeModelUnavailableError(
    `Configured ${provider} model is unavailable: ${requestedModel}. ` +
      `Paseo reports ${describeCatalog(models)}.`,
  );
}

function selectFreeOpenCodeModel(
  models: readonly PaseoModelDescriptor[],
): PaseoModelDescriptor {
  const freeModels = models.filter(isExplicitlyFreeModel);
  for (const preferred of preferredFreeOpenCodeModels) {
    const match = freeModels.find((model) => model.id === preferred);
    if (match) {
      return match;
    }
  }

  const fallback = freeModels.toSorted((left, right) =>
    left.id.localeCompare(right.id),
  )[0];
  if (!fallback) {
    throw new RuntimeModelUnavailableError(
      'OpenCode did not report an explicitly free model.',
    );
  }
  return fallback;
}

function selectProviderDefaultModel(
  provider: ManagedEnvironmentProvider,
  models: readonly PaseoModelDescriptor[],
): PaseoModelDescriptor {
  const selectable = models.filter((model) => model.isSelectable !== false);
  const preferred =
    selectable.find((model) => model.isDefault) ?? selectable[0];
  if (!preferred) {
    throw new RuntimeModelUnavailableError(
      `Paseo reported no ${provider} models. Check that the provider is ` +
        'installed and signed in.',
    );
  }
  return preferred;
}

function describeCatalog(models: readonly PaseoModelDescriptor[]): string {
  if (models.length === 0) return 'no models for this provider';
  const shown = models.slice(0, REPORTED_MODEL_ID_LIMIT).map((m) => m.id);
  const suffix =
    models.length > shown.length
      ? `, +${models.length - shown.length} more`
      : '';
  return `${shown.join(', ')}${suffix}`;
}
