import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../shared/config.js';
import { runLarkEntrypoint } from './worker.js';

const baseConfig: AppConfig = {
  nodeEnv: 'test',
  host: '127.0.0.1',
  port: 3000,
  logLevel: 'info',
  serviceName: 'test',
  directChatPlane: 'execution_runtime',
  productWorkSurface: 'composed',
  teamCompletionApprovalRequired: false,
  skillRegistryRoot: '/tmp/agent-server-test/skill-registry',
  paseo: {
    wsUrl: 'ws://127.0.0.1:6767/ws',
    agentCwd: '/tmp/agent-server-test',
    provider: 'opencode',
    workspaceTitle: 'test',
    connectTimeoutMs: 100,
    connectTimeoutSource: 'default',
    executionTimeoutMs: 1000,
    executionTimeoutSource: 'default',
    sessionRpcTimeoutMs: 2000,
    sessionRpcTimeoutSource: 'default',
  },
};

function fakeSignals() {
  const handlers = new Map<string, () => void>();
  return {
    process: {
      once(signal: string, handler: () => void) {
        handlers.set(signal, handler);
      },
      removeListener(signal: string, handler: () => void) {
        if (handlers.get(signal) === handler) handlers.delete(signal);
      },
    },
    signal(signal: string) {
      handlers.get(signal)?.();
    },
  };
}

describe('Lark worker entrypoint', () => {
  it('fails closed when the Lark canary is disabled without creating a service', async () => {
    const createService = vi.fn();
    await expect(
      runLarkEntrypoint({
        loadConfig: () => baseConfig,
        createService,
        process: fakeSignals().process,
      }),
    ).rejects.toThrow('Lark worker requires enabled Lark configuration');
    expect(createService).not.toHaveBeenCalled();
  });

  it('creates the real service and closes it once on SIGTERM', async () => {
    const signals = fakeSignals();
    const close = vi.fn(async () => undefined);
    const createService = vi.fn(async () => ({ close }));
    const enabledConfig = {
      ...baseConfig,
      larkCanary: {
        enabled: true as const,
        connectionKey: 'connection',
        appId: 'cli_0123456789abcdef',
        domain: 'feishu' as const,
        appSecret: 'secret',
        botOpenId: 'bot',
        allowedChatId: 'chat',
        allowedOpenId: 'user',
        tenantId: 'tenant',
        workspaceId: 'workspace',
        serviceAccountId: 'service',
        publishedAgentVersionId: 'agent',
        policyVersion: 'policy',
      },
    };
    const running = runLarkEntrypoint({
      loadConfig: () => enabledConfig,
      createService,
      process: signals.process,
    });
    await vi.waitFor(() => expect(createService).toHaveBeenCalledOnce());
    signals.signal('SIGTERM');
    await running;
    expect(close).toHaveBeenCalledOnce();
  });

  it('settles with a safe shutdown failure when service close rejects', async () => {
    const signals = fakeSignals();
    const createService = vi.fn(async () => ({
      close: vi.fn().mockRejectedValue(new Error('database secret')),
    }));
    const running = runLarkEntrypoint({
      loadConfig: () => ({
        ...baseConfig,
        larkCanary: {
          enabled: true as const,
          connectionKey: 'connection-error',
          appId: 'cli_0123456789abcdef',
          domain: 'feishu' as const,
          appSecret: 'secret',
          botOpenId: 'bot',
          allowedChatId: 'chat',
          allowedOpenId: 'user',
          tenantId: 'tenant',
          workspaceId: 'workspace',
          serviceAccountId: 'service',
          publishedAgentVersionId: 'agent',
          policyVersion: 'policy',
        },
      }),
      createService,
      process: signals.process,
    });
    await vi.waitFor(() => expect(createService).toHaveBeenCalledOnce());
    signals.signal('SIGTERM');
    await expect(running).rejects.toThrow('Lark worker shutdown failed');
  });
});
