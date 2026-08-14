import { describe, expect, it } from 'vitest';

import type { ExecutionSession } from '../ports/execution-plane.js';
import { ExecutionRunRegistry } from './execution-run-registry.js';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('ExecutionRunRegistry', () => {
  it('exposes only the active turn for cancellation and clears it afterwards', async () => {
    const registry = new ExecutionRunRegistry();
    const gate = deferred<void>();
    const cancelled: string[] = [];
    const session: ExecutionSession = {
      capabilities: { supported: new Set() },
      run: async () => {
        await gate.promise;
        return {
          status: 'completed',
          output: { provider: 'opencode', model: 'free/model', text: 'done' },
        };
      },
      cancel: async (runId) => {
        cancelled.push(runId);
      },
      close: async () => undefined,
    };

    const active = registry.run(session, { runId: 'run-1', prompt: 'work' });
    expect(registry.has('run-1')).toBe(true);
    await registry.cancel('run-1');
    expect(cancelled).toEqual(['run-1']);

    gate.resolve();
    await active;
    expect(registry.has('run-1')).toBe(false);
    await registry.cancel('run-1');
    expect(cancelled).toEqual(['run-1']);
  });

  it('rejects a second active handle for the same durable Run id', async () => {
    const registry = new ExecutionRunRegistry();
    const gate = deferred<void>();
    const session: ExecutionSession = {
      capabilities: { supported: new Set() },
      run: async () => {
        await gate.promise;
        return { status: 'cancelled' };
      },
      close: async () => undefined,
    };
    const first = registry.run(session, { runId: 'run-1', prompt: 'one' });
    await expect(
      registry.run(session, { runId: 'run-1', prompt: 'two' }),
    ).rejects.toThrow(/already active/i);
    gate.resolve();
    await first;
  });
});
