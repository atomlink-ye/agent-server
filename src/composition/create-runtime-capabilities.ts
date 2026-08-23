import { PASEO_PLANE_CAPABILITIES } from '../adapters/paseo/paseo-execution-plane.js';
import {
  createRuntimeCapabilities,
  type RuntimeCapabilities,
} from '../application/runtime/runtime-capabilities.js';
import type { AppConfig } from '../shared/config.js';

/**
 * Derives the execution contract from configuration before any Runtime exists.
 * The composition root owns the provider selection; application code consumes
 * only the resulting value.
 */
export function createConfiguredRuntimeCapabilities(
  config: Pick<AppConfig, 'runtime'>,
): RuntimeCapabilities {
  return createRuntimeCapabilities(
    config.runtime?.adapter === 'paseo'
      ? PASEO_PLANE_CAPABILITIES.supported
      : [],
  );
}
