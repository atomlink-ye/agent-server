import { describe, expect, it } from 'vitest';

import { ConfigurationError, loadConfig } from './config.js';

describe('loadConfig', () => {
  it('provides deterministic local defaults', () => {
    expect(loadConfig({}, '/repo')).toEqual({
      nodeEnv: 'development',
      host: '127.0.0.1',
      port: 3_000,
      logLevel: 'info',
      serviceName: 'agent-server',
      paseo: {
        wsUrl: 'ws://127.0.0.1:6767/ws',
        agentCwd: '/repo/.local/agent-workspace',
        workspaceTitle: 'Agent Server Baseline',
        connectTimeoutMs: 10_000,
        executionTimeoutMs: 120_000,
      },
    });
  });

  it('parses an explicitly configured port', () => {
    expect(loadConfig({ PORT: '4100' }).port).toBe(4_100);
  });

  it('fails before startup when configuration is invalid', () => {
    expect(() => loadConfig({ PORT: '70000' })).toThrow(ConfigurationError);
  });

  it('accepts an explicit Paseo model as an operator override', () => {
    expect(
      loadConfig(
        {
          PASEO_MODEL: 'opencode/mimo-v2.5-free',
          PASEO_AGENT_CWD: 'runtime-workspace',
        },
        '/repo',
      ).paseo,
    ).toMatchObject({
      model: 'opencode/mimo-v2.5-free',
      agentCwd: '/repo/runtime-workspace',
    });
  });
});
