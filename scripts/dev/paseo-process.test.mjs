import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  classifyDaemonStartupFailure,
  getAvailablePort,
  parsePositiveSafeIntegerEnvironmentVariable,
  startPaseo,
  tailFile,
  waitForHttp,
} from './paseo-process.mjs';
import { createApplicationEnvironment } from './with-paseo-environment.mjs';

describe('createApplicationEnvironment', () => {
  it('forwards the session RPC timeout into the application child environment', () => {
    const environment = createApplicationEnvironment({
      paseoEnvironment: { PASEO_RELAY_ENABLED: 'false' },
      environment: {
        PASEO_SESSION_RPC_TIMEOUT_MS: '120000',
        PASEO_RUNTIME_ROOT: '/workspace/.local/runtime-browser/runtime',
      },
      paseoWsUrl: 'ws://127.0.0.1:6767/ws',
      agentWorkspace: '/workspace/.local/agent-workspace',
    });

    expect(environment).toMatchObject({
      PASEO_SESSION_RPC_TIMEOUT_MS: '120000',
      PASEO_RUNTIME_ROOT: '/workspace/.local/runtime-browser/runtime',
      PASEO_WS_URL: 'ws://127.0.0.1:6767/ws',
      PASEO_AGENT_CWD: '/workspace/.local/agent-workspace',
    });
  });
});

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

describe('daemon startup diagnostics', () => {
  it('classifies an exited daemon before process cleanup', () => {
    expect(classifyDaemonStartupFailure({ exitCode: 17 })).toBe(
      'daemon exited with exitCode=17',
    );
    expect(classifyDaemonStartupFailure({ exitCode: null })).toBe(
      'daemon remained running but unhealthy',
    );
  });

  it('returns the last requested log lines and an unavailable placeholder', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'paseo-daemon-test-'));
    const path = join(directory, 'daemon.log');
    try {
      await writeFile(path, 'one\ntwo\nthree\nfour\n');
      await expect(tailFile(path, 2)).resolves.toBe('three\nfour');
      await rm(path);
      await expect(tailFile(path, 2)).resolves.toContain(
        '[daemon log unavailable:',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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

function waitForExit(child) {
  return new Promise((resolveExit, rejectExit) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolveExit({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    child.once('error', rejectExit);
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
}

function waitForMessage(child, kind) {
  return new Promise((resolveMessage, rejectMessage) => {
    let stderr = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      child.removeListener('message', onMessage);
      rejectMessage(
        new Error(
          `timed out waiting for owner message: ${kind}${stderr ? `\n${stderr}` : ''}`,
        ),
      );
    }, 10_000);
    const onMessage = (message) => {
      if (!message || message.kind !== kind) return;
      clearTimeout(timer);
      child.removeListener('message', onMessage);
      resolveMessage(message);
    };
    child.on('message', onMessage);
    child.once('error', (error) => {
      clearTimeout(timer);
      child.removeListener('message', onMessage);
      rejectMessage(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      child.removeListener('message', onMessage);
      rejectMessage(
        new Error(
          `owner exited before message ${kind} (${code ?? signal ?? 'unknown'})${stderr ? `\n${stderr}` : ''}`,
        ),
      );
    });
  });
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('startPaseo startup signal cleanup', () => {
  it('stops the daemon when SIGTERM arrives during health readiness', async () => {
    if (process.platform === 'win32') return;

    const directory = await mkdtemp(join(tmpdir(), 'paseo-startup-signal-'));
    const daemon = join(directory, 'fake-paseo.mjs');
    await writeFile(
      daemon,
      '#!/usr/bin/env node\nsetInterval(() => undefined, 1000);\n',
      { mode: 0o700 },
    );
    await chmod(daemon, 0o700);
    const port = await getAvailablePort();
    const paseoProcessModule = pathToFileURL(
      fileURLToPath(new URL('./paseo-process.mjs', import.meta.url)),
    ).href;
    const canaryModule = pathToFileURL(
      fileURLToPath(
        new URL('../../tooling/dev/run-canary.ts', import.meta.url),
      ),
    ).href;
    const owner = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
          import { createCanarySignalLifecycle } from ${JSON.stringify(canaryModule)};
          import { getAvailablePort, startPaseo } from ${JSON.stringify(paseoProcessModule)};

          const children = [];
          const lifecycle = createCanarySignalLifecycle(children);
          const keepalive = setInterval(() => undefined, 1000);
          const startup = startPaseo({
            repositoryRoot: process.cwd(),
            runtimeRoot: process.env.TEST_RUNTIME_ROOT,
            port: Number(process.env.TEST_PASEO_PORT),
            environmentVariableNames: [],
            onChild: (child) => {
              lifecycle.register(child);
              process.send?.({ kind: 'daemon', pid: child.pid });
            },
          });
          await lifecycle.signal;
          process.send?.({ kind: 'after-signal' });
          await lifecycle.cleanup();
          process.send?.({ kind: 'after-cleanup' });
          await startup.catch(() => undefined);
          process.send?.({ kind: 'after-startup' });
          clearInterval(keepalive);
          lifecycle.dispose();
          process.exitCode = 143;
        `,
      ],
      {
        cwd: fileURLToPath(new URL('../..', import.meta.url)),
        env: {
          ...process.env,
          PASEO_BIN: daemon,
          OPENCODE_BIN: daemon,
          CLAUDE_CODE_BIN: daemon,
          CODEX_BIN: daemon,
          PASEO_DAEMON_STARTUP_TIMEOUT_MS: '1000',
          TEST_RUNTIME_ROOT: directory,
          TEST_PASEO_PORT: String(port),
        },
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      },
    );
    try {
      const { pid } = await waitForMessage(owner, 'daemon');
      expect(pid).toEqual(expect.any(Number));
      expect(processAlive(pid)).toBe(true);
      owner.kill('SIGTERM');
      await waitForMessage(owner, 'after-signal');
      await waitForMessage(owner, 'after-cleanup');
      await expect(waitForExit(owner)).resolves.toMatchObject({ code: 143 });
      expect(processAlive(pid)).toBe(false);
    } finally {
      if (owner.exitCode === null && owner.signalCode === null) {
        owner.kill('SIGKILL');
      }
      await waitForExit(owner).catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('with-paseo startup signal cleanup', () => {
  it('exits 143 after SIGTERM interrupts daemon readiness', async () => {
    if (process.platform === 'win32') return;

    const directory = await mkdtemp(join(tmpdir(), 'with-paseo-signal-'));
    const daemon = join(directory, 'fake-paseo.cjs');
    const pidFile = join(directory, 'paseo-home', 'startup-daemon.pid');
    await writeFile(
      daemon,
      `#!/usr/bin/env node
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const home = process.argv[process.argv.indexOf('--home') + 1];
writeFileSync(join(home, 'startup-daemon.pid'), String(process.pid));
setInterval(() => undefined, 1000);
`,
      { mode: 0o700 },
    );
    await chmod(daemon, 0o700);
    const port = await getAvailablePort();
    const wrapper = spawn(
      process.execPath,
      [
        '--require',
        fileURLToPath(
          new URL('./with-paseo-signal-test-preload.cjs', import.meta.url),
        ),
        fileURLToPath(new URL('./with-paseo.mjs', import.meta.url)),
        '--',
        process.execPath,
        '-e',
        'setInterval(() => undefined, 1000)',
      ],
      {
        cwd: fileURLToPath(new URL('../..', import.meta.url)),
        env: {
          ...process.env,
          OPENCODE_GO_API_KEY: 'test-key',
          PASEO_PORT: String(port),
          PASEO_RUNTIME_ROOT: directory,
          PASEO_DAEMON_STARTUP_TIMEOUT_MS: '1000',
          TEST_FAKE_PROVIDER_BIN: daemon,
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    let wrapperStderr = '';
    wrapper.stderr?.setEncoding('utf8');
    wrapper.stderr?.on('data', (chunk) => {
      wrapperStderr += chunk;
    });
    try {
      let daemonPid;
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline && daemonPid === undefined) {
        try {
          daemonPid = Number((await readFile(pidFile, 'utf8')).trim());
        } catch {
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
        }
      }
      if (daemonPid === undefined || !Number.isInteger(daemonPid)) {
        throw new Error(
          `daemon PID was not published${wrapperStderr ? `\n${wrapperStderr}` : ''}`,
        );
      }
      expect(daemonPid).toBeGreaterThan(0);
      expect(processAlive(daemonPid)).toBe(true);
      wrapper.kill('SIGTERM');
      await expect(waitForExit(wrapper)).resolves.toMatchObject({ code: 143 });
      expect(processAlive(daemonPid)).toBe(false);
    } finally {
      if (wrapper.exitCode === null && wrapper.signalCode === null) {
        wrapper.kill('SIGKILL');
      }
      await waitForExit(wrapper).catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);
});
