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
    ...(config.paseo.additionalProviders
      ? { additionalProviders: config.paseo.additionalProviders }
      : {}),
    cwd: config.paseo.agentCwd,
    workspaceTitle: config.paseo.workspaceTitle,
    ...sessionEnvironment(config.paseo),
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

/**
 * The provider environment one Agent session runs in.
 *
 * Both names answer the same question -- which environment is this Agent's --
 * and neither answers it alone. `CODEX_HOME` moves the credential, config and
 * MCP surface off the operator's own directory; `HOME` moves everything a
 * provider reads relative to the home *outside* that directory, of which
 * `$HOME/.agents/skills` is the one that shows up verbatim in the Agent's
 * prompt. Set only what the runtime actually prepared: a deployment that
 * prepared no home keeps the process environment it was started with, which is
 * the honest behaviour for an operator who chose to run it that way.
 */
function sessionEnvironment(
  paseo: Pick<AppConfig['paseo'], 'codexHome' | 'providerHome'>,
): Pick<PaseoRuntimeProviderOptions, 'sessionEnvironment'> {
  const environment = {
    ...(paseo.codexHome ? { CODEX_HOME: paseo.codexHome } : {}),
    ...(paseo.providerHome ? { HOME: paseo.providerHome } : {}),
  };
  return Object.keys(environment).length > 0
    ? { sessionEnvironment: environment }
    : {};
}
