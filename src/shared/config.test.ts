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
      serviceAccounts: [],
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

  it('loads static service-account bindings with tenant workspace and policy metadata', () => {
    expect(
      loadConfig(
        {
          SERVICE_ACCOUNTS_JSON: JSON.stringify([
            {
              serviceAccountId: 'svc_alpha',
              token: 'token-alpha',
              tenantId: 'tenant_alpha',
              workspaceId: 'workspace_main',
              policyVersion: 'policy-2026-07-22',
            },
          ]),
        },
        '/repo',
      ).serviceAccounts,
    ).toEqual([
      {
        serviceAccountId: 'svc_alpha',
        token: 'token-alpha',
        tenantId: 'tenant_alpha',
        workspaceId: 'workspace_main',
        policyVersion: 'policy-2026-07-22',
        disabled: false,
      },
    ]);
  });

  it('rejects malformed static service-account configuration before startup', () => {
    expect(() =>
      loadConfig({
        SERVICE_ACCOUNTS_JSON: JSON.stringify([
          {
            serviceAccountId: 'svc_alpha',
            tenantId: 'tenant_alpha',
            workspaceId: 'workspace_main',
            policyVersion: 'policy-2026-07-22',
          },
        ]),
      }),
    ).toThrow(ConfigurationError);
  });

  it('rejects duplicate static service-account token values before startup', () => {
    expect(() =>
      loadConfig({
        SERVICE_ACCOUNTS_JSON: JSON.stringify([
          {
            serviceAccountId: 'svc_alpha',
            token: 'token-duplicate',
            tenantId: 'tenant_alpha',
            workspaceId: 'workspace_main',
            policyVersion: 'policy-2026-07-22',
          },
          {
            serviceAccountId: 'svc_beta',
            token: 'token-duplicate',
            tenantId: 'tenant_beta',
            workspaceId: 'workspace_other',
            policyVersion: 'policy-2026-07-22',
          },
        ]),
      }),
    ).toThrow(/duplicate service-account token/i);
  });

  it('rejects conflicting duplicate service-account ids across different owner scopes before startup', () => {
    expect(() =>
      loadConfig({
        SERVICE_ACCOUNTS_JSON: JSON.stringify([
          {
            serviceAccountId: 'svc_alpha',
            token: 'token-alpha-1',
            tenantId: 'tenant_alpha',
            workspaceId: 'workspace_main',
            policyVersion: 'policy-2026-07-22',
          },
          {
            serviceAccountId: 'svc_alpha',
            token: 'token-alpha-2',
            tenantId: 'tenant_beta',
            workspaceId: 'workspace_other',
            policyVersion: 'policy-2026-07-22',
          },
        ]),
      }),
    ).toThrow(/conflicting service-account id binding/i);
  });
});
