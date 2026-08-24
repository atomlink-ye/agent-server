import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';

import {
  runCommand,
  spawnOwned,
  stopOwned,
  waitForHttp,
} from '../../tooling/dev/host-native.js';

async function ephemeralPort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('ephemeral port unavailable'));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) reject(error);
        else resolvePort(port);
      });
    });
  });
}

describe('runCommand abortOn primary child', () => {
  it('aborts a long command promptly when the tracked primary child exits after start', async () => {
    const environment = { ...process.env };
    const primary = spawnOwned(
      process.execPath,
      ['-e', 'setTimeout(() => process.exit(7), 150)'],
      { environment, logName: 'canary-primary-child-race' },
    );
    const started = Date.now();
    await expect(
      runCommand(
        process.execPath,
        ['-e', 'setInterval(() => undefined, 1000)'],
        {
          environment,
          abortOn: {
            child: primary,
            environment,
            label: 'golden-path dev',
          },
        },
      ),
    ).rejects.toThrow(/canary primary child exited while .+ was running/u);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('lets a successful command finish when the primary child stays alive', async () => {
    const environment = { ...process.env };
    const primary = spawnOwned(
      process.execPath,
      ['-e', 'setInterval(() => undefined, 1000)'],
      { environment, logName: 'canary-primary-child-success' },
    );
    try {
      await runCommand(process.execPath, ['-e', 'process.exit(0)'], {
        environment,
        abortOn: {
          child: primary,
          environment,
          label: 'golden-path dev',
        },
      });
    } finally {
      await stopOwned([primary]);
    }
  });

  it('aborts within 30s when health checks fail while the primary stays alive', async () => {
    const environment = { ...process.env };
    const port = await ephemeralPort();
    const primary = spawnOwned(
      process.execPath,
      [
        '-e',
        `
          const http = require('node:http');
          const server = http.createServer((request, response) => {
            response.writeHead(200);
            response.end('ok');
          });
          server.listen(${port}, '127.0.0.1', () => {
            setTimeout(() => server.close(), 1500);
          });
          setInterval(() => undefined, 1000);
        `,
      ],
      { environment, logName: 'canary-health-abort' },
    );
    const started = Date.now();
    try {
      await waitForHttp(`http://127.0.0.1:${port}/`);
      await expect(
        runCommand(
          process.execPath,
          ['-e', 'setInterval(() => undefined, 1000)'],
          {
            environment,
            abortOn: {
              child: primary,
              environment,
              label: 'golden-path dev',
              healthUrl: `http://127.0.0.1:${port}/health/ready`,
              healthFailureLimit: 3,
            },
          },
        ),
      ).rejects.toThrow(/failed health while .+ was running/u);
      expect(Date.now() - started).toBeLessThan(30_000);
    } finally {
      await stopOwned([primary]);
    }
  });

  it('stopOwned kills the POSIX process group', async () => {
    if (process.platform === 'win32') return;
    const environment = { ...process.env };
    const primary = spawnOwned(
      process.execPath,
      [
        '-e',
        `
          const { spawn } = require('node:child_process');
          spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'], {
            stdio: 'ignore',
          });
          setInterval(() => undefined, 1000);
        `,
      ],
      { environment, logName: 'canary-stop-owned-group' },
    );
    await new Promise<void>((resolveDelay) => {
      setTimeout(resolveDelay, 200);
    });
    await stopOwned([primary]);
    expect(primary.exitCode !== null || primary.signalCode !== null).toBe(true);
  });
});
