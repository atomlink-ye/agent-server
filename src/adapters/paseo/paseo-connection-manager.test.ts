import { describe, expect, it, vi } from 'vitest';

import { RuntimeModelUnavailableError } from './errors.js';
import {
  PaseoConnectionManager,
  type PaseoConnectionManagerOptions,
} from './paseo-connection-manager.js';
import { FakePaseoClientPort } from '../../../tests/fixtures/fake-paseo-client.js';

const logger = { log: () => undefined };

function createManager(
  client: FakePaseoClientPort,
  overrides: Partial<PaseoConnectionManagerOptions> = {},
) {
  return new PaseoConnectionManager(
    client,
    {
      cwd: '/tmp/agent-server-connection-manager-test',
      provider: 'opencode',
      workspaceTitle: 'Connection Manager Test',
      ...overrides,
    },
    logger,
  );
}

/** What Paseo 0.7.0 reports for Claude: a default marker and no free marker. */
const claudeModels = [
  { id: 'claude-opus-5', label: 'Opus 5', isDefault: true },
  { id: 'claude-sonnet-5', label: 'Sonnet 5' },
];

describe('PaseoConnectionManager', () => {
  it('coalesces initialization and retries startup connection', async () => {
    const client = new FakePaseoClientPort();
    client.connectHook = async (call) => {
      if (call < 3) throw new Error('starting');
    };
    const manager = createManager(client);

    await Promise.all([manager.initialize(), manager.initialize()]);

    expect(client.connectCalls).toBe(3);
    expect(client.openWorkspaceCalls).toBe(1);
    expect(client.listModelsCalls).toBe(1);
    expect(manager.health()).toMatchObject({
      connected: true,
      workspaceReady: true,
      modelReady: true,
    });
  });

  it('reconnects without recreating cached model/workspace state', async () => {
    const client = new FakePaseoClientPort();
    const manager = createManager(client);
    await manager.initialize();
    client.status = 'disconnected';

    await manager.initialize();

    expect(client.connectCalls).toBe(2);
    expect(client.openWorkspaceCalls).toBe(1);
    expect(client.listModelsCalls).toBe(1);
  });

  it('does not restore stale readiness after close', async () => {
    const client = new FakePaseoClientPort();
    const manager = createManager(client);
    const stale = deferred<void>();
    client.connectHook = async (call) => {
      if (call === 1) await stale.promise;
    };

    const attempt = manager.initialize();
    await vi.waitFor(() => expect(client.connectCalls).toBe(1));
    await manager.close();
    stale.resolve();
    await attempt;

    expect(manager.health()).toMatchObject({
      connected: false,
      workspaceReady: false,
      modelReady: false,
    });
  });

  it('keeps a newer initialization authoritative over a stale reconnect', async () => {
    const client = new FakePaseoClientPort();
    const manager = createManager(client);
    const staleReconnect = deferred<void>();
    client.connectHook = async (call) => {
      if (call === 2) await staleReconnect.promise;
    };

    await manager.initialize();
    client.status = 'disconnected';
    const staleAttempt = manager.initialize();
    await vi.waitFor(() => expect(client.connectCalls).toBe(2));
    await manager.close();
    await manager.initialize();
    staleReconnect.resolve();
    await staleAttempt;

    expect(manager.health()).toMatchObject({
      connected: true,
      workspaceReady: true,
      modelReady: true,
    });
  });

  it('becomes model-ready for Claude on the operator-pinned demo model', async () => {
    const client = new FakePaseoClientPort();
    client.models = claudeModels;
    const manager = createManager(client, {
      provider: 'claude',
      requestedModel: 'claude-sonnet-5',
    });

    await manager.initialize();

    expect(manager.model?.id).toBe('claude-sonnet-5');
    expect(manager.health()).toMatchObject({ modelReady: true });
  });

  it('becomes model-ready for Claude with no configured model', async () => {
    const client = new FakePaseoClientPort();
    client.models = claudeModels;
    const manager = createManager(client, { provider: 'claude' });

    await manager.initialize();

    expect(manager.model?.id).toBe('claude-opus-5');
    expect(manager.health()).toMatchObject({ modelReady: true });
  });

  it('fails closed when the configured model policy cannot resolve a free model', async () => {
    const client = new FakePaseoClientPort();
    client.models = [{ id: 'opencode/paid', label: 'Paid' }];

    await expect(createManager(client).initialize()).rejects.toThrow(
      RuntimeModelUnavailableError,
    );
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
