import { describe, expect, it } from 'vitest';

import { readBoundedJson } from './read-bounded-json.js';

describe('readBoundedJson', () => {
  it.each([
    ['early oversized content length', { contentLength: '10' }, 'too_large'],
    ['actual overflow', {}, 'too_large'],
    ['fatal UTF-8 decode', {}, 'invalid_json'],
    ['read failure', {}, 'invalid_json'],
  ])('cancels and releases on %s', async (name, _options, expected) => {
    let cancelled = 0;
    let released = 0;
    let reads = 0;
    const sequence =
      name === 'actual overflow'
        ? [{ value: new Uint8Array(11) }]
        : name === 'fatal UTF-8 decode'
          ? [{ value: new Uint8Array([0xc3, 0x28]) }, { done: true }]
          : [];
    const reader = {
      async read(): Promise<
        { done: true; value?: undefined } | { done: false; value: Uint8Array }
      > {
        if (name === 'read failure') throw new Error('stream read failed');
        const next = sequence[reads++];
        if (!next || 'done' in next) return { done: true, value: undefined };
        return { done: false, value: next.value };
      },
      async cancel() {
        cancelled += 1;
      },
      releaseLock() {
        released += 1;
      },
    };
    const request = {
      body: { getReader: () => reader },
      headers: new Headers(
        name === 'early oversized content length'
          ? { 'content-length': '11' }
          : undefined,
      ),
    } as unknown as Request;

    await expect(readBoundedJson(request, 10)).rejects.toMatchObject({
      code: expected === 'too_large' ? 'request_too_large' : 'invalid_json',
    });
    expect(cancelled).toBe(1);
    expect(released).toBe(1);
  });
});
