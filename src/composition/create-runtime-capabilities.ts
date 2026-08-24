import {
  createRuntimeCapabilities,
  type RuntimeCapabilities,
} from '../application/runtime/runtime-capabilities.js';
import type { ExecutionPlaneCapabilities } from '../application/ports/execution-plane.js';
import type { AppConfig } from '../shared/config.js';

const PASEO_PLANE_CAPABILITIES: ExecutionPlaneCapabilities = {
  supported: new Set([
    'streaming',
    'cancellation',
    'reusable_session',
    'external_workspace',
    'timeline_replay',
    'permissions',
    'nested_activities',
    'provider_discovery',
    'platform_mcp',
  ]),
};

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
