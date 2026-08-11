import { createServer } from 'node:http';

import { describe, expect, it } from 'vitest';

import {
  parsePositiveSafeIntegerEnvironmentVariable,
  waitForHttp,
} from './paseo-process.mjs';

describe('parsePositiveSafeIntegerEnvironmentVariable', () => {
  it.each([undefined, '', ' ', '\t\n'])(
    'uses the default for blank value %j',
    (value) => {
      expect(
        parsePositiveSafeIntegerEnvironmentVariable('TIMEOUT', value, 123),
      ).toBe(123);
    },
  );

  it.each(['abc', '0', '-1', '1.5'])('rejects invalid value %j', (value) => {
    expect(() =>
      parsePositiveSafeIntegerEnvironmentVariable('TIMEOUT', value, 123),
    ).toThrow('TIMEOUT must be a positive decimal safe integer.');
  });
});

describe('waitForHttp', () => {
  it('includes an unhealthy response body when readiness times out', async () => {
    const readinessDetail = 'worker queue is still warming up';
    const responseBody = JSON.stringify({
      status: 'not_ready',
      checks: [
        { name: 'runtime', status: 'not_ready', detail: readinessDetail },
      ],
    });
    const server = createServer((_request, response) => {
      response.statusCode = 503;
      response.setHeader('content-type', 'application/json');
      response.end(responseBody);
    });

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();

    try {
      if (!address || typeof address === 'string') {
        throw new Error('Could not determine the test server address.');
      }

      let rejection;
      try {
        await waitForHttp(`http://127.0.0.1:${address.port}/health`, 350);
      } catch (error) {
        rejection = error;
      }

      expect(rejection).toBeInstanceOf(Error);
      expect(rejection.message).toContain('HTTP 503');
      expect(rejection.message).toContain(responseBody);
      expect(rejection.message).toContain(readinessDetail);
    } finally {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
