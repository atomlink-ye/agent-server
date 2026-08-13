import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';

import { resolveOpenCodeBinary } from './resolve-opencode.mjs';
import { resolvePaseoBinary } from './resolve-paseo.mjs';
import { resolveProviderBinary } from './resolve-provider.mjs';
import {
  copyNamedEnvironment,
  createSafeRuntimeEnvironment,
} from './safe-environment.mjs';
import { loadRealProviderDefaults } from './real-provider-defaults.mjs';

const MAX_HTTP_ERROR_BODY_LENGTH = 4_096;
const REAL_PROVIDER_DEFAULTS = loadRealProviderDefaults();

export function classifyDaemonStartupFailure(child) {
  return child && child.exitCode !== null
    ? `daemon exited with exitCode=${child.exitCode}`
    : 'daemon remained running but unhealthy';
}

export function classifyPaseoStartupGate(logTail, budgets) {
  if (/OpenCode app\.agents timed out/iu.test(logTail)) {
    return `PASEO_OPENCODE_APP_AGENTS_TIMEOUT_MS gate timed out after ${budgets.openCodeAppAgentsTimeoutMs}ms`;
  }
  if (/OpenCode provider\.list timed out/iu.test(logTail)) {
    return `PASEO_OPENCODE_PROVIDER_LIST_TIMEOUT_MS gate timed out after ${budgets.openCodeProviderListTimeoutMs}ms`;
  }
  if (/OpenCode server startup timeout/iu.test(logTail)) {
    return `PASEO_OPENCODE_SERVER_STARTUP_TIMEOUT_MS gate timed out after ${budgets.openCodeStartupTimeoutMs}ms`;
  }
  if (
    /Timed out (?:checking .* availability|refreshing .*) after/iu.test(logTail)
  ) {
    return `PASEO_PROVIDER_REFRESH_TIMEOUT_MS gate timed out after ${budgets.providerRefreshTimeoutMs}ms`;
  }
  return null;
}

export async function tailFile(path, lineCount = 30) {
  try {
    const content = await readFile(path, 'utf8');
    const lines = content.split(/\r?\n/);
    if (lines.at(-1) === '') lines.pop();
    return lines.slice(-lineCount).join('\n') || '[daemon log is empty]';
  } catch (error) {
    return `[daemon log unavailable: ${error instanceof Error ? error.message : String(error)}]`;
  }
}

export function parsePositiveSafeIntegerEnvironmentVariable(
  name,
  value,
  defaultValue,
) {
  if (
    value === undefined ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    return defaultValue;
  }
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a positive decimal safe integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive decimal safe integer.`);
  }
  return parsed;
}

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

/**
 * A persisted Paseo home can outlive the container that created it. Only a
 * A parseable marker from another hostname is stale. For the same hostname
 * (for example `docker compose restart` reusing a container hostname), retain
 * it only when the PID is live and `/proc` identifies that PID as Paseo.
 * Unreadable or ambiguous markers remain fail-closed.
 */
export async function removeStalePaseoPid(paseoHome) {
  const pidPath = join(paseoHome, 'paseo.pid');
  let content;
  try {
    content = await readFile(pidPath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      process.stderr.write(
        'Paseo stale-pid check: paseo.pid could not be read; left untouched.\n',
      );
    }
    return false;
  }

  let marker;
  try {
    marker = JSON.parse(content);
  } catch {
    process.stderr.write(
      'Paseo stale-pid check: paseo.pid is not parseable; left untouched.\n',
    );
    return false;
  }
  const recordedHostname =
    marker && typeof marker === 'object' && typeof marker.hostname === 'string'
      ? marker.hostname.trim()
      : '';
  const recordedPid =
    marker && typeof marker === 'object' ? marker.pid : undefined;
  const parsedPid =
    typeof recordedPid === 'number'
      ? recordedPid
      : typeof recordedPid === 'string' && /^\d+$/u.test(recordedPid.trim())
        ? Number(recordedPid.trim())
        : NaN;
  const currentHostname = hostname().trim();
  if (!recordedHostname || !Number.isSafeInteger(parsedPid) || parsedPid <= 0) {
    process.stderr.write(
      'Paseo stale-pid check: paseo.pid has no valid pid/hostname; left untouched.\n',
    );
    return false;
  }
  if (!currentHostname) {
    process.stderr.write(
      'Paseo stale-pid check: current container hostname is unavailable; left untouched.\n',
    );
    return false;
  }
  if (recordedHostname === currentHostname) {
    let alive = true;
    try {
      process.kill(parsedPid, 0);
    } catch (error) {
      alive = error?.code === 'EPERM';
    }
    if (alive && process.platform === 'linux') {
      try {
        const commandLine = await readFile(`/proc/${parsedPid}/cmdline`, 'utf8');
        alive = /(?:^|\0|\/)paseo(?:\0|$)/u.test(commandLine);
      } catch {
        alive = false;
      }
    }
    if (alive) {
      process.stderr.write(
        'Paseo stale-pid check: paseo.pid names a live process in this container; left untouched.\n',
      );
      return false;
    }
    try {
      await unlink(pidPath);
      process.stderr.write(
        'Paseo stale-pid check: paseo.pid names a dead process in this container; removed stale marker.\n',
      );
      return true;
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        process.stderr.write(
          'Paseo stale-pid check: dead-process paseo.pid could not be removed; left untouched.\n',
        );
      }
      return false;
    }
  }

  try {
    await unlink(pidPath);
    process.stderr.write(
      'Paseo stale-pid check: paseo.pid belongs to a different container; removed stale marker.\n',
    );
    return true;
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      process.stderr.write(
        'Paseo stale-pid check: stale paseo.pid could not be removed; left untouched.\n',
      );
    }
    return false;
  }
}

export async function startPaseo({
  repositoryRoot,
  runtimeRoot,
  port,
  listenHost = '127.0.0.1',
  environmentVariableNames = [],
}) {
  const startupTimeoutMs = parsePositiveSafeIntegerEnvironmentVariable(
    'PASEO_DAEMON_STARTUP_TIMEOUT_MS',
    process.env.PASEO_DAEMON_STARTUP_TIMEOUT_MS,
    Number(REAL_PROVIDER_DEFAULTS.PASEO_DAEMON_STARTUP_TIMEOUT_MS),
  );
  const openCodeStartupTimeoutMs = parsePositiveSafeIntegerEnvironmentVariable(
    'PASEO_OPENCODE_SERVER_STARTUP_TIMEOUT_MS',
    process.env.PASEO_OPENCODE_SERVER_STARTUP_TIMEOUT_MS,
    Number(REAL_PROVIDER_DEFAULTS.PASEO_OPENCODE_SERVER_STARTUP_TIMEOUT_MS),
  );
  const providerRefreshTimeoutMs = parsePositiveSafeIntegerEnvironmentVariable(
    'PASEO_PROVIDER_REFRESH_TIMEOUT_MS',
    process.env.PASEO_PROVIDER_REFRESH_TIMEOUT_MS,
    Number(REAL_PROVIDER_DEFAULTS.PASEO_PROVIDER_REFRESH_TIMEOUT_MS),
  );
  const openCodeAppAgentsTimeoutMs =
    parsePositiveSafeIntegerEnvironmentVariable(
      'PASEO_OPENCODE_APP_AGENTS_TIMEOUT_MS',
      process.env.PASEO_OPENCODE_APP_AGENTS_TIMEOUT_MS,
      Number(REAL_PROVIDER_DEFAULTS.PASEO_OPENCODE_APP_AGENTS_TIMEOUT_MS),
    );
  const openCodeProviderListTimeoutMs =
    parsePositiveSafeIntegerEnvironmentVariable(
      'PASEO_OPENCODE_PROVIDER_LIST_TIMEOUT_MS',
      process.env.PASEO_OPENCODE_PROVIDER_LIST_TIMEOUT_MS,
      Number(REAL_PROVIDER_DEFAULTS.PASEO_OPENCODE_PROVIDER_LIST_TIMEOUT_MS),
    );
  const openCodeSessionCreateTimeoutMs =
    parsePositiveSafeIntegerEnvironmentVariable(
      'PASEO_OPENCODE_SESSION_CREATE_TIMEOUT_MS',
      process.env.PASEO_OPENCODE_SESSION_CREATE_TIMEOUT_MS,
      Number(REAL_PROVIDER_DEFAULTS.PASEO_OPENCODE_SESSION_CREATE_TIMEOUT_MS),
    );
  const isolated = await createIsolatedRuntimeEnvironment(runtimeRoot);
  await removeStalePaseoPid(isolated.paseoHome);
  const paseoBinary = await resolvePaseoBinary();
  await resolveProviderBinary('claude', 'CLAUDE_CODE_BIN');
  await resolveProviderBinary('codex', 'CODEX_BIN');
  const logPath = join(runtimeRoot, 'paseo-daemon.log');
  // One file represents one attempt. Appending lets an old timeout or SIGTERM
  // misclassify a later failure whose own log contains no such event.
  const log = openSync(logPath, 'w');
  const hostnames = process.env.PASEO_HOSTNAMES;
  const hostnameArguments = hostnames?.trim() ? ['--hostnames', hostnames] : [];
  const environment = {
    ...isolated.environment,
    ...copyNamedEnvironment(process.env, environmentVariableNames),
    ...(openCodeStartupTimeoutMs === undefined
      ? {}
      : {
          PASEO_OPENCODE_SERVER_STARTUP_TIMEOUT_MS: String(
            openCodeStartupTimeoutMs,
          ),
        }),
    ...(providerRefreshTimeoutMs === undefined
      ? {}
      : {
          PASEO_PROVIDER_REFRESH_TIMEOUT_MS: String(providerRefreshTimeoutMs),
        }),
    ...(openCodeAppAgentsTimeoutMs === undefined
      ? {}
      : {
          PASEO_OPENCODE_APP_AGENTS_TIMEOUT_MS: String(
            openCodeAppAgentsTimeoutMs,
          ),
        }),
    ...(openCodeProviderListTimeoutMs === undefined
      ? {}
      : {
          PASEO_OPENCODE_PROVIDER_LIST_TIMEOUT_MS: String(
            openCodeProviderListTimeoutMs,
          ),
        }),
    ...(openCodeSessionCreateTimeoutMs === undefined
      ? {}
      : {
          PASEO_OPENCODE_SESSION_CREATE_TIMEOUT_MS: String(
            openCodeSessionCreateTimeoutMs,
          ),
        }),
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
        // Opt-in only. The dev runtime keeps the Paseo web UI off by default so
        // an isolated daemon stays headless; PASEO_DEV_WEB_UI=1 turns it on for
        // visually inspecting Team transcripts (all members share one workspace).
        // `--web-ui` is the enabling flag; omitting `--no-web-ui` is not the
        // same thing and leaves the UI off.
        ...(process.env.PASEO_DEV_WEB_UI === '1'
          ? ['--web-ui']
          : ['--no-web-ui']),
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
    await waitForHttp(
      `http://127.0.0.1:${port}/api/health`,
      startupTimeoutMs,
      child,
    );
  } catch (error) {
    const failureState = classifyDaemonStartupFailure(child);
    try {
      await stopProcessTree(child);
    } catch {
      // Preserve the original startup failure and include the log tail below.
    }
    const logTail = await tailFile(logPath);
    const startupGate = classifyPaseoStartupGate(logTail, {
      startupTimeoutMs,
      openCodeStartupTimeoutMs,
      providerRefreshTimeoutMs,
      openCodeAppAgentsTimeoutMs,
      openCodeProviderListTimeoutMs,
    });
    const probeFailure = error instanceof Error ? error.message : String(error);
    const failureCause = startupGate
      ? startupGate
      : probeFailure.startsWith('timed out waiting for ')
        ? `PASEO_DAEMON_STARTUP_TIMEOUT_MS gate timed out after ${startupTimeoutMs}ms`
        : `daemon failed before the startup deadline (${probeFailure})`;
    throw new Error(
      `Paseo startup failed: ${failureCause}; process state: ${failureState}. Last health probe: ${probeFailure}. See ${logPath}.\nLast daemon log lines:\n${logTail}`,
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
      const responseBody = (await response.text()).trim();
      const boundedBody = responseBody.slice(0, MAX_HTTP_ERROR_BODY_LENGTH);
      lastError = new Error(
        boundedBody
          ? `HTTP ${response.status}: ${boundedBody}`
          : `HTTP ${response.status}`,
      );
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
