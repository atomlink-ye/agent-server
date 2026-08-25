import { createServer } from 'node:http';

import { describe, expect, it } from 'vitest';

import { resolveCachedId } from './web-bootstrap.mjs';

/**
 * Starts a tiny HTTP server that responds with `status` for every request,
 * mirroring how a real Agent Server would answer a GET for a cached fixture
 * id. Returns the base URL and a `close()` to tear it down.
 */
async function startStatusServer(status) {
  const server = createServer((_request, response) => {
    response.statusCode = status;
    response.end();
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Could not determine the test server address.');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      }),
  };
}

/** Mirrors how `request()`/`readPublished()` in web-bootstrap.mjs report an
 * unexpected HTTP status: a thrown Error carrying the numeric `.status`. */
function httpStatusError(status) {
  const error = new Error(`Agent Server bootstrap request failed (${status}).`);
  error.status = status;
  return error;
}

describe('resolveCachedId', () => {
  it('recreates the fixture when the cached id 404s instead of throwing', async () => {
    const recreate = async () => 'fresh-id';
    const result = await resolveCachedId({
      label: 'agent version',
      cachedId: 'stale-id',
      check: async () => {
        throw httpStatusError(404);
      },
      recreate,
    });

    expect(result).toBe('fresh-id');
  });

  it('keeps the cached id when the live check succeeds', async () => {
    let recreateCalls = 0;
    const result = await resolveCachedId({
      label: 'agent version',
      cachedId: 'live-id',
      check: async () => ({ status: 'published' }),
      recreate: async () => {
        recreateCalls += 1;
        return 'fresh-id';
      },
    });

    expect(result).toBe('live-id');
    expect(recreateCalls).toBe(0);
  });

  it('propagates a 500 instead of treating it as a stale cache', async () => {
    const recreate = async () => 'fresh-id';

    await expect(
      resolveCachedId({
        label: 'agent version',
        cachedId: 'stale-id',
        check: async () => {
          throw httpStatusError(500);
        },
        recreate,
      }),
    ).rejects.toThrow('Agent Server bootstrap request failed (500).');
  });

  it('propagates a network/connection error instead of treating it as a stale cache', async () => {
    const recreate = async () => 'fresh-id';

    await expect(
      resolveCachedId({
        label: 'agent version',
        cachedId: 'stale-id',
        check: async () => {
          throw new Error(
            'Agent Server is not reachable. Start the local API first.',
          );
        },
        recreate,
      }),
    ).rejects.toThrow('Agent Server is not reachable.');
  });

  it('recreates immediately when there is no cached id at all', async () => {
    const check = async () => {
      throw new Error('check must not run without a cached id');
    };
    const result = await resolveCachedId({
      label: 'agent version',
      cachedId: '',
      check,
      recreate: async () => 'fresh-id',
    });

    expect(result).toBe('fresh-id');
  });

  it('reflects a real 404 HTTP response end-to-end against a live server', async () => {
    const { baseUrl, close } = await startStatusServer(404);
    try {
      const result = await resolveCachedId({
        label: 'workspace',
        cachedId: 'stale-workspace-id',
        check: async () => {
          const response = await fetch(
            `${baseUrl}/api/v1/workspaces/stale-workspace-id`,
          );
          if (response.status !== 200) throw httpStatusError(response.status);
        },
        recreate: async () => 'fresh-workspace-id',
      });
      expect(result).toBe('fresh-workspace-id');
    } finally {
      await close();
    }
  });

  it('reflects a real 500 HTTP response end-to-end against a live server by failing loudly', async () => {
    const { baseUrl, close } = await startStatusServer(500);
    try {
      await expect(
        resolveCachedId({
          label: 'workspace',
          cachedId: 'stale-workspace-id',
          check: async () => {
            const response = await fetch(
              `${baseUrl}/api/v1/workspaces/stale-workspace-id`,
            );
            if (response.status !== 200) throw httpStatusError(response.status);
          },
          recreate: async () => 'fresh-workspace-id',
        }),
      ).rejects.toThrow('Agent Server bootstrap request failed (500).');
    } finally {
      await close();
    }
  });
});
