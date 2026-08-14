import { strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import { cleanupOwnedProcess } from './owned-process-cleanup.mjs';

function child(exitCode = null) {
  const value = new EventEmitter();
  value.exitCode = exitCode;
  return value;
}

describe('C4 owned-process cleanup duals', () => {
  it('requires a collector and reports unavailable as incomplete', async () => {
    const result = await cleanupOwnedProcess(null);
    assert.deepEqual(result, {
      complete: false,
      residual: false,
      status: 'missing',
      reason: 'collector-unavailable',
    });
  });

  it('awaits SIGTERM exit and records exit code', async () => {
    const process = child();
    const resultPromise = cleanupOwnedProcess(process, {
      killImpl: (value) => {
        value.exitCode = 143;
        queueMicrotask(() => value.emit('exit', 143, 'SIGTERM'));
      },
    });
    assert.deepEqual(await resultPromise, {
      complete: true,
      residual: false,
      status: 'complete',
      exitCode: 143,
    });
  });

  it('does not claim no residual when TERM is ignored', async () => {
    const result = await cleanupOwnedProcess(child(), {
      timeoutMs: 5,
      killImpl: () => {},
    });
    assert.deepEqual(result, {
      complete: false,
      residual: true,
      status: 'residual',
      reason: 'term-timeout',
    });
  });
});

