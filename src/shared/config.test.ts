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
      larkCanary: { enabled: false },
      skillRegistryRoot: '/repo/.local/skill-registry',
      paseo: {
        wsUrl: 'ws://127.0.0.1:6767/ws',
        agentCwd: '/repo/.local/agent-workspace',
        runtimeCellRoot: '/repo/.local/runtime-cells',
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

  it('loads a disabled-by-default fixed Lark canary without requiring secrets', () => {
    const config = loadConfig({});
    expect(config.larkCanary).toEqual({ enabled: false });
    expect(JSON.stringify(config)).not.toContain('LARK_CANARY_APP_SECRET');
  });

  it('loads the enabled canary and keeps the app secret runtime-only', () => {
    const config = loadConfig(validLarkEnvironment());
    expect(config.larkCanary).toMatchObject({
      enabled: true,
      connectionKey: 'canary-connection',
      appId: 'cli_app',
      domain: 'feishu',
      botOpenId: 'ou_bot',
      allowedChatId: 'oc_chat',
      allowedOpenId: 'ou_user',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      serviceAccountId: 'svc-1',
      publishedAgentVersionId: 'agent-version-1',
      policyVersion: 'policy-1',
    });
    expect(config.larkCanary).toHaveProperty(
      'appSecret',
      'secret-runtime-only',
    );
  });

  it.each([
    ['missing secret', { LARK_CANARY_APP_SECRET: '' }],
    ['missing domain', { LARK_CANARY_DOMAIN: '' }],
    ['unknown domain', { LARK_CANARY_DOMAIN: 'other' }],
    ['missing service account', { LARK_CANARY_SERVICE_ACCOUNT_ID: 'unknown' }],
    [
      'disabled service account',
      {
        SERVICE_ACCOUNTS_JSON: JSON.stringify([
          { ...account(), disabled: true },
        ]),
      },
    ],
    ['mismatched tenant', { LARK_CANARY_TENANT_ID: 'tenant-other' }],
    ['mismatched workspace', { LARK_CANARY_WORKSPACE_ID: 'workspace-other' }],
    ['mismatched policy', { LARK_CANARY_POLICY_VERSION: 'policy-other' }],
  ])('rejects enabled canary with %s', (_label, override) => {
    expect(() =>
      loadConfig({ ...validLarkEnvironment(), ...override }),
    ).toThrow(ConfigurationError);
  });
});

function account() {
  return {
    serviceAccountId: 'svc-1',
    token: 'token-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    policyVersion: 'policy-1',
  };
}

function validLarkEnvironment(): NodeJS.ProcessEnv {
  return {
    LARK_CANARY_ENABLED: 'true',
    LARK_CANARY_CONNECTION_KEY: 'canary-connection',
    LARK_CANARY_APP_ID: 'cli_app',
    LARK_CANARY_DOMAIN: 'feishu',
    LARK_CANARY_APP_SECRET: 'secret-runtime-only',
    LARK_CANARY_BOT_OPEN_ID: 'ou_bot',
    LARK_CANARY_ALLOWED_CHAT_ID: 'oc_chat',
    LARK_CANARY_ALLOWED_OPEN_ID: 'ou_user',
    LARK_CANARY_TENANT_ID: 'tenant-1',
    LARK_CANARY_WORKSPACE_ID: 'workspace-1',
    LARK_CANARY_SERVICE_ACCOUNT_ID: 'svc-1',
    LARK_CANARY_PUBLISHED_AGENT_VERSION_ID: 'agent-version-1',
    LARK_CANARY_POLICY_VERSION: 'policy-1',
    SERVICE_ACCOUNTS_JSON: JSON.stringify([account()]),
  };
}
