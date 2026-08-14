import { describe, expect, it, vi } from 'vitest';

import { OpenCodeModelUnavailableError } from '../../src/adapters/paseo/errors.js';
import { PaseoRuntimeAdapter } from '../../src/adapters/paseo/paseo-runtime-adapter.js';
import {
  RuntimeExecutionError,
  RuntimeTimedOutError,
} from '../../src/application/ports/agent-runtime.js';
import { createLogger } from '../../src/shared/observability/logger.js';
import { FakePaseoClientPort } from '../fixtures/fake-paseo-client.js';

const logger = createLogger({
  service: 'adapter-test',
  minimumLevel: 'error',
  write: () => undefined,
});

function createAdapter(client: FakePaseoClientPort) {
  return new PaseoRuntimeAdapter(
    {
      wsUrl: 'ws://127.0.0.1:6767/ws',
      cwd: '/tmp/agent-server-adapter-test',
      provider: 'opencode',
      workspaceTitle: 'Adapter Test',
      connectTimeoutMs: 1_000,
      executionTimeoutMs: 1_000,
    },
    logger,
    client,
  );
}

describe('PaseoRuntimeAdapter', () => {
  it('initializes and reuses one explicit workspace', async () => {
    const client = new FakePaseoClientPort();
    client.connectHook = async (call) => {
      if (call < 3) throw new Error('runtime is still starting');
    };
    const adapter = createAdapter(client);

    await Promise.all([adapter.initialize(), adapter.initialize()]);
    const first = await adapter.execute({
      operation: 'create',
      runId: 'run-1',
      prompt: 'first',
      systemPrompt: '',
    });
    const second = await adapter.execute({
      operation: 'create',
      runId: 'run-2',
      prompt: 'second',
      systemPrompt: '',
    });

    expect(first.text).toBe('PASEO_FAKE_OK');
    expect(first.runtimeWorkspaceId).toBe('workspace-1');
    expect(second.model).toBe('opencode/deepseek-v4-flash-free');
    expect(client.connectCalls).toBe(3);
    expect(client.openWorkspaceCalls).toBe(1);
    expect(client.titleCalls).toBe(1);
    expect(client.listModelsCalls).toBe(1);
    expect(client.createAgentCalls).toBe(2);
  });

  it('reconnects a cached workspace when the websocket disconnects', async () => {
    const client = new FakePaseoClientPort();
    const adapter = createAdapter(client);

    await adapter.initialize();
    client.status = 'disconnected';
    const result = await adapter.execute({
      operation: 'create',
      runId: 'run-after-disconnect',
      prompt: 'continue',
      systemPrompt: '',
    });

    expect(result.text).toBe('PASEO_FAKE_OK');
    expect(client.connectCalls).toBe(2);
    expect(client.openWorkspaceCalls).toBe(1);
    expect(client.titleCalls).toBe(1);
    expect(client.listModelsCalls).toBe(1);
    expect(client.createAgentCalls).toBe(1);
    expect((await adapter.health()).ready).toBe(true);
  });

  it('does not let a stale reconnect clear a newer initialization attempt', async () => {
    const client = new FakePaseoClientPort();
    const adapter = createAdapter(client);
    const staleReconnect = deferred<void>();
    const freshInitialization = deferred<void>();
    client.connectHook = async (call) => {
      if (call === 2) await staleReconnect.promise;
      if (call === 3) await freshInitialization.promise;
    };

    await adapter.initialize();
    client.status = 'disconnected';
    const staleAttempt = adapter.initialize();
    await Promise.resolve();
    await adapter.close();
    const freshAttempt = adapter.initialize();
    await vi.waitFor(() => expect(client.connectCalls).toBe(3));

    staleReconnect.resolve();
    await staleAttempt;
    expect(client.closeCalls).toBe(1);
    const coalescedAttempt = adapter.initialize();
    await Promise.resolve();
    expect(client.connectCalls).toBe(3);

    freshInitialization.resolve();
    await Promise.all([freshAttempt, coalescedAttempt]);
    expect((await adapter.health()).ready).toBe(true);
  });

  it('does not restore readiness when initialization finishes after close', async () => {
    const client = new FakePaseoClientPort();
    const adapter = createAdapter(client);
    const staleConnection = deferred<void>();
    client.connectHook = async (call) => {
      if (call === 1) await staleConnection.promise;
    };

    const staleAttempt = adapter.initialize();
    await vi.waitFor(() => expect(client.connectCalls).toBe(1));
    await adapter.close();
    staleConnection.resolve();
    await staleAttempt;

    const health = await adapter.health();
    expect(health.ready).toBe(false);
    expect(client.status).toBe('disposed');
    expect(client.closeCalls).toBe(2);
    expect(
      health.checks.find((check) => check.name === 'paseo_workspace'),
    ).toMatchObject({ ready: false });
    expect(
      health.checks.find((check) => check.name === 'opencode_model'),
    ).toMatchObject({ ready: false });
  });

  it('does not let a stale reconnect close a newer completed connection', async () => {
    const client = new FakePaseoClientPort();
    const adapter = createAdapter(client);
    const staleReconnect = deferred<void>();
    client.connectHook = async (call) => {
      if (call === 2) await staleReconnect.promise;
    };

    await adapter.initialize();
    client.status = 'disconnected';
    const staleAttempt = adapter.initialize();
    await vi.waitFor(() => expect(client.connectCalls).toBe(2));
    await adapter.close();
    await adapter.initialize();
    expect(client.connectCalls).toBe(3);
    expect((await adapter.health()).ready).toBe(true);

    staleReconnect.resolve();
    await staleAttempt;

    expect(client.closeCalls).toBe(1);
    expect(client.status).toBe('connected');
    expect((await adapter.health()).ready).toBe(true);
  });

  it('fails readiness when no explicitly free model exists', async () => {
    const client = new FakePaseoClientPort();
    client.models = [{ id: 'opencode/paid', label: 'Paid' }];
    const adapter = createAdapter(client);

    await expect(adapter.initialize()).rejects.toThrow(
      OpenCodeModelUnavailableError,
    );
    expect((await adapter.health()).ready).toBe(false);
  });

  it('does not expose raw initialization errors through readiness', async () => {
    const client = new FakePaseoClientPort();
    client.listModelsError = new Error(
      'catalog failed at /private/workspace with provider-secret',
    );
    const adapter = createAdapter(client);

    await expect(adapter.initialize()).rejects.toThrow('provider-secret');
    const health = await adapter.health();

    expect(health.ready).toBe(false);
    expect(JSON.stringify(health)).not.toContain('/private/workspace');
    expect(JSON.stringify(health)).not.toContain('provider-secret');
    expect(
      health.checks
        .filter((check) => !check.ready)
        .map((check) => check.detail),
    ).toEqual([
      'Runtime initialization failed.',
      'Runtime initialization failed.',
    ]);
  });

  it('maps Paseo timeout and error states to stable runtime errors', async () => {
    const timeoutClient = new FakePaseoClientPort();
    timeoutClient.finished = {
      status: 'timeout',
      error: null,
      lastMessage: null,
    };
    await expect(
      createAdapter(timeoutClient).execute({
        operation: 'create',
        runId: 'run-1',
        prompt: 'test',
        systemPrompt: '',
      }),
    ).rejects.toThrow(RuntimeTimedOutError);

    const errorClient = new FakePaseoClientPort();
    errorClient.finished = {
      status: 'error',
      error: 'provider failed',
      lastMessage: null,
    };
    await expect(
      createAdapter(errorClient).execute({
        operation: 'create',
        runId: 'run-2',
        prompt: 'test',
        systemPrompt: '',
      }),
    ).rejects.toThrow(RuntimeExecutionError);
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
