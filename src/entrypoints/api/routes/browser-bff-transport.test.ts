import { describe, expect, it } from 'vitest';

import {
  isUpstreamOversizeResponse,
  readJson,
  type UpstreamOversizeResponse,
} from './browser-bff-transport.js';

// Mirrors the module's internal MAX_UPSTREAM_JSON_BYTES. Not exported: these
// tests assert observable readJson behavior at the boundary, not the
// constant's identity.
const CAP_BYTES = 1 * 1024 * 1024;

type FakeReaderChunk =
  | { readonly done?: false; readonly value: Uint8Array }
  | { readonly done: true };

function fakeReader(chunks: readonly FakeReaderChunk[]): {
  readonly reader: {
    read(): Promise<
      { done: true; value?: undefined } | { done: false; value: Uint8Array }
    >;
    cancel(): Promise<void>;
    releaseLock(): void;
  };
  readonly cancelCount: () => number;
  readonly releaseCount: () => number;
} {
  let cancelled = 0;
  let released = 0;
  let index = 0;
  return {
    reader: {
      async read() {
        const next = chunks[index++];
        if (!next || 'done' in next) return { done: true, value: undefined };
        return { done: false, value: next.value };
      },
      async cancel() {
        cancelled += 1;
      },
      releaseLock() {
        released += 1;
      },
    },
    cancelCount: () => cancelled,
    releaseCount: () => released,
  };
}

describe('readJson', () => {
  it('returns an oversize marker (not undefined) when the declared content-length exceeds the cap, and never reads the body', async () => {
    let bodyCancelled = 0;
    const declared = CAP_BYTES + 1;
    const response = {
      headers: new Headers({ 'content-length': String(declared) }),
      body: {
        async cancel() {
          bodyCancelled += 1;
        },
        // The declared-length check must short-circuit before this is ever
        // called; calling it would prove the fix regressed to buffering an
        // upstream body it already knows it must reject.
        getReader() {
          throw new Error('must not read a body already rejected by size');
        },
      },
    } as unknown as Response;

    const result = await readJson(response);

    expect(isUpstreamOversizeResponse(result)).toBe(true);
    expect((result as UpstreamOversizeResponse).declaredBytes).toBe(declared);
    expect(bodyCancelled).toBe(1);
  });

  it('returns an oversize marker when the streamed body exceeds the cap without a declared content-length', async () => {
    const overflowChunk = new Uint8Array(CAP_BYTES + 10);
    const { reader, cancelCount, releaseCount } = fakeReader([
      { value: overflowChunk },
      { done: true },
    ]);
    const response = {
      headers: new Headers(),
      body: { getReader: () => reader },
    } as unknown as Response;

    const result = await readJson(response);

    expect(isUpstreamOversizeResponse(result)).toBe(true);
    expect((result as UpstreamOversizeResponse).declaredBytes).toBe(
      overflowChunk.byteLength,
    );
    expect(cancelCount()).toBe(1);
    expect(releaseCount()).toBe(1);
  });

  it('still returns undefined (not the oversize marker) when the body genuinely fails to decode', async () => {
    // Invalid UTF-8 (a lone continuation byte), well under the cap: this is
    // a decode failure, not a size failure, and the two must stay
    // distinguishable.
    const { reader } = fakeReader([
      { value: new Uint8Array([0xc3, 0x28]) },
      { done: true },
    ]);
    const response = {
      headers: new Headers(),
      body: { getReader: () => reader },
    } as unknown as Response;

    const result = await readJson(response);

    expect(result).toBeUndefined();
    expect(isUpstreamOversizeResponse(result)).toBe(false);
  });
});

describe('isUpstreamOversizeResponse', () => {
  it('only matches the marker shape readJson returns', () => {
    expect(
      isUpstreamOversizeResponse({
        upstreamOversize: true,
        declaredBytes: 5,
      }),
    ).toBe(true);
    expect(isUpstreamOversizeResponse(undefined)).toBe(false);
    expect(isUpstreamOversizeResponse(null)).toBe(false);
    expect(isUpstreamOversizeResponse({ upstreamOversize: false })).toBe(false);
    expect(isUpstreamOversizeResponse({ ok: true })).toBe(false);
  });
});
