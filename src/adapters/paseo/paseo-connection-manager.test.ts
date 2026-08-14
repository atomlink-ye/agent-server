import { describe, expect, it, vi } from 'vitest';

import { OpenCodeModelUnavailableError } from './errors.js';
import { PaseoConnectionManager } from './paseo-connection-manager.js';
import { FakePaseoClientPort } from '../../../tests/fixtures/fake-paseo-client.js';

const logger = { log: () => undefined };

function createManager(client: FakePaseoClientPort) {
  return new PaseoConnectionManager(
    client,
    {
      cwd: '/tmp/agent-server-connection-manager-test',
      provider: 'opencode',
      workspaceTitle: 'Connection Manager Test',
    },
    logger,
  );
}

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

  it('fails closed when the configured model policy cannot resolve a free model', async () => {
    const client = new FakePaseoClientPort();
    client.models = [{ id: 'opencode/paid', label: 'Paid' }];

    await expect(createManager(client).initialize()).rejects.toThrow(
      OpenCodeModelUnavailableError,
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
