import type { AppConfig } from '../../../shared/config.js';
import { normalizePaseoRequestedModel } from './paseo-model-normalizer.js';
import type { PaseoRuntimeProviderOptions } from './paseo-runtime-provider.js';

/** Maps application configuration at the Paseo infrastructure boundary. */
export function mapPaseoConfig(
  config: Pick<AppConfig, 'paseo'>,
): PaseoRuntimeProviderOptions {
  return {
    wsUrl: config.paseo.wsUrl,
    provider: config.paseo.provider,
    cwd: config.paseo.agentCwd,
    workspaceTitle: config.paseo.workspaceTitle,
    ...(config.paseo.model
      ? {
          requestedModel: normalizePaseoRequestedModel(
            config.paseo.provider,
            config.paseo.model,
          ),
        }
      : {}),
    connectTimeoutMs: config.paseo.connectTimeoutMs,
    executionTimeoutMs: config.paseo.executionTimeoutMs,
    executionTimeoutSource: config.paseo.executionTimeoutSource,
  };
}
