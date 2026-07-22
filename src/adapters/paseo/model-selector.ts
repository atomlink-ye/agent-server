import { OpenCodeModelUnavailableError } from './errors.js';

export interface PaseoModelDescriptor {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
}

export const preferredFreeOpenCodeModels = [
  'opencode/mimo-v2.5-free',
  'opencode/deepseek-v4-flash-free',
  'opencode/north-mini-code-free',
  'opencode/nemotron-3-ultra-free',
  'opencode/hy3-free',
] as const;

export function isExplicitlyFreeModel(model: PaseoModelDescriptor): boolean {
  return (
    /(?:^|[-/])free(?:$|-)/i.test(model.id) ||
    /\bfree\b/i.test(model.label) ||
    (model.description !== undefined && /\bfree\b/i.test(model.description))
  );
}

export function selectOpenCodeModel(
  models: readonly PaseoModelDescriptor[],
  requestedModel?: string,
): PaseoModelDescriptor {
  if (requestedModel) {
    const requested = models.find((model) => model.id === requestedModel);
    if (!requested) {
      throw new OpenCodeModelUnavailableError(
        `Configured OpenCode model is unavailable: ${requestedModel}`,
      );
    }
    return requested;
  }

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
    throw new OpenCodeModelUnavailableError(
      'OpenCode did not report an explicitly free model.',
    );
  }
  return fallback;
}
