import { describe, expect, it } from 'vitest';

import type { AppConfig } from '../../../shared/config.js';
import { mapPaseoConfig } from './paseo-config-mapper.js';

function paseoConfig(
  overrides: Partial<AppConfig['paseo']> = {},
): Pick<AppConfig, 'paseo'> {
  return {
    paseo: {
      wsUrl: 'ws://127.0.0.1:6767/ws',
      provider: 'codex',
      agentCwd: '/srv/agent-workspace',
      workspaceTitle: 'Agent Server',
      connectTimeoutMs: 10_000,
      connectTimeoutSource: 'default',
      executionTimeoutMs: 150_000,
      executionTimeoutSource: 'default',
      sessionRpcTimeoutMs: 60_000,
      sessionRpcTimeoutSource: 'default',
      ...overrides,
    },
  };
}

describe('mapPaseoConfig session environment', () => {
  it('names both homes, because a Codex home alone still leaves the skill library open', () => {
    const mapped = mapPaseoConfig(
      paseoConfig({
        codexHome: '/srv/runtime/home/.codex',
        providerHome: '/srv/runtime/home',
      }),
    );

    expect(mapped.sessionEnvironment).toEqual({
      CODEX_HOME: '/srv/runtime/home/.codex',
      HOME: '/srv/runtime/home',
    });
  });

  it('leaves the provider environment alone when the runtime prepared no home', () => {
    expect(mapPaseoConfig(paseoConfig()).sessionEnvironment).toBeUndefined();
  });

  it('names whichever home was prepared without inventing the other', () => {
    expect(
      mapPaseoConfig(paseoConfig({ providerHome: '/srv/runtime/home' }))
        .sessionEnvironment,
    ).toEqual({ HOME: '/srv/runtime/home' });
  });
});
