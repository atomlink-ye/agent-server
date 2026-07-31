import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';

import { resolveOpenCodeBinary } from './resolve-opencode.mjs';
import {
  copyNamedEnvironment,
  createSafeRuntimeEnvironment,
} from './safe-environment.mjs';

export async function getAvailablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Could not allocate a local TCP port.');
  }
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

export async function createIsolatedRuntimeEnvironment(runtimeRoot) {
  const openCodeBinary = await resolveOpenCodeBinary();
  const home = join(runtimeRoot, 'home');
  const paseoHome = join(runtimeRoot, 'paseo-home');
  const xdgConfig = join(runtimeRoot, 'xdg-config');
  const xdgData = join(runtimeRoot, 'xdg-data');
  const xdgCache = join(runtimeRoot, 'xdg-cache');
  await Promise.all(
    [home, paseoHome, xdgConfig, xdgData, xdgCache].map((path) =>
      mkdir(path, { recursive: true }),
    ),
  );

  const environment = {
    ...createSafeRuntimeEnvironment(),
    HOME: home,
    PASEO_HOME: paseoHome,
    XDG_CONFIG_HOME: xdgConfig,
    XDG_DATA_HOME: xdgData,
    XDG_CACHE_HOME: xdgCache,
    PASEO_RELAY_ENABLED: 'false',
    PASEO_DICTATION_ENABLED: 'false',
    PASEO_VOICE_MODE_ENABLED: 'false',
    ...(process.env.PASEO_CORS_ORIGINS
      ? { PASEO_CORS_ORIGINS: process.env.PASEO_CORS_ORIGINS }
      : {}),
    PATH: `${dirname(openCodeBinary)}:${process.env.PATH ?? ''}`,
  };
  return { environment, home, paseoHome, openCodeBinary };
}

export async function startPaseo({
  repositoryRoot,
  runtimeRoot,
  port,
  listenHost = '127.0.0.1',
  environmentVariableNames = [],
}) {
  const isolated = await createIsolatedRuntimeEnvironment(runtimeRoot);
  const paseoBinary = join(repositoryRoot, 'node_modules', '.bin', 'paseo');
  const logPath = join(runtimeRoot, 'paseo-daemon.log');
  const log = openSync(logPath, 'a');
  const hostnames = process.env.PASEO_HOSTNAMES;
  const hostnameArguments = hostnames ? ['--hostnames', hostnames] : [];
  const environment = {
    ...isolated.environment,
    ...copyNamedEnvironment(process.env, environmentVariableNames),
    PWD: repositoryRoot,
  };

  let child;
  try {
    child = spawn(
      paseoBinary,
      [
        'start',
        '--foreground',
        '--listen',
        `${listenHost}:${port}`,
        '--home',
        isolated.paseoHome,
        '--no-relay',
        '--no-mcp',
        '--no-inject-mcp',
        '--no-web-ui',
        ...hostnameArguments,
      ],
      {
        cwd: repositoryRoot,
        env: environment,
        detached: process.platform !== 'win32',
        stdio: ['ignore', log, log],
      },
    );
  } finally {
    closeSync(log);
  }

  try {
    await waitForHttp(`http://127.0.0.1:${port}/api/health`, 30_000, child);
  } catch (error) {
    await stopProcessTree(child);
    throw new Error(
      `Paseo did not become healthy. See ${logPath}. ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return {
    child,
    environment,
    home: isolated.home,
    paseoHome: isolated.paseoHome,
    openCodeBinary: isolated.openCodeBinary,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    healthUrl: `http://127.0.0.1:${port}/api/health`,
    logPath,
  };
}

export async function waitForHttp(url, timeoutMs, child) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      throw new Error(`process exited with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(200);
  }
  throw new Error(
    `timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

export async function stopProcessTree(child, timeoutMs = 8_000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  signalProcessTree(child, 'SIGTERM');
  if (await waitForExit(child, timeoutMs)) {
    return;
  }
  signalProcessTree(child, 'SIGKILL');
  await waitForExit(child, 2_000);
}

export function isProcessAlive(pid) {
  if (!pid) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalProcessTree(child, signal) {
  try {
    if (process.platform === 'win32') {
      child.kill(signal);
    } else if (child.pid) {
      process.kill(-child.pid, signal);
    }
  } catch (error) {
    if (error?.code !== 'ESRCH') {
      throw error;
    }
  }
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    child.once('exit', onExit);
  });
}

export function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
