import type { ChildProcess } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  LOCAL_SERVICE_TOKEN,
  LOCAL_WORKSPACE_ID,
  hostRuntimeEnvironment,
  hostWebEnvironment,
  isPortFree,
  loadLocalDotEnv,
  localServiceAccountsJson,
  ownedChildLogPath,
  prepareHostNativeEnvironment,
  readRuntimeLogTail,
  repositoryRoot,
  runCommand,
  spawnOwned,
  stopOwned,
  waitForHttp,
} from './host-native.js';
import { setupProviders } from './setup-providers.js';

export type CanaryKind =
  | 'runtime'
  | 'golden-path'
  | 'agent-team'
  | 'team-registry-work'
  | 'user-defined-team-work';

const runtimeSmokeCommands: Partial<Record<CanaryKind, string[]>> = {
  runtime: ['scripts/smoke/runtime-main-flow.mjs'],
  'agent-team': ['scripts/smoke/agent-team-main-flow.mjs'],
  'team-registry-work': ['scripts/smoke/team-registry-work-actor.mjs'],
  'user-defined-team-work': [
    'scripts/smoke/user-defined-team-work-lifecycle.mjs',
  ],
};

const webBootstrapEnvPath = resolve(repositoryRoot, '.local/web-bootstrap.env');

function canaryPort(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const value = Number.parseInt(
    environment[name]?.trim() || String(fallback),
    10,
  );
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be between 1 and 65535 (received ${value})`);
  }
  return value;
}

async function assertCanaryPortFree(
  label: string,
  port: number,
): Promise<void> {
  if (!(await isPortFree(port))) {
    throw new Error(
      `${label} port 127.0.0.1:${port} is already in use; stop the existing process before running the canary.`,
    );
  }
}

function parseKind(value: string | undefined): CanaryKind {
  if (
    value === 'runtime' ||
    value === 'golden-path' ||
    value === 'agent-team' ||
    value === 'team-registry-work' ||
    value === 'user-defined-team-work'
  )
    return value;
  throw new Error(
    'usage: run-canary.ts <runtime|golden-path|agent-team|team-registry-work|user-defined-team-work>',
  );
}

function canaryReadyTimeout(environment: NodeJS.ProcessEnv): number {
  const configured =
    environment.CANARY_READY_TIMEOUT_MS?.trim() ||
    environment.PASEO_DAEMON_STARTUP_TIMEOUT_MS?.trim();
  const parsed = configured ? Number.parseInt(configured, 10) : 300_000;
  return Number.isFinite(parsed) ? Math.max(parsed, 300_000) : 300_000;
}

export async function runHostCanary(
  kind: CanaryKind,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const loaded = await loadLocalDotEnv(environment);
  const children: ChildProcess[] = [];
  let primaryChild: ChildProcess | undefined;
  let primaryEnvironment: NodeJS.ProcessEnv | undefined;
  try {
    let commandEnvironment: NodeJS.ProcessEnv;
    const runtimeSmokeCommand = runtimeSmokeCommands[kind];
    if (runtimeSmokeCommand) {
      // Runtime compatibility does not need to boot Vite/browser. Start only
      // the host-native API wrapped by the existing Paseo helper, then run one
      // bounded real-provider turn.
      const prepared = await prepareHostNativeEnvironment(loaded);
      const runtimeEnvironment: NodeJS.ProcessEnv = {
        ...hostRuntimeEnvironment(prepared),
        ...(kind === 'runtime'
          ? {}
          : { SERVICE_ACCOUNTS_JSON: localServiceAccountsJson() }),
      };
      const apiPort = canaryPort(runtimeEnvironment, 'PORT', 3000);
      await assertCanaryPortFree('runtime API', apiPort);
      const readyTimeoutMs = canaryReadyTimeout(runtimeEnvironment);
      await setupProviders(runtimeEnvironment);
      const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
      const api = spawnOwned(
        'node',
        [
          'scripts/dev/with-paseo.mjs',
          '--',
          'node',
          '--import',
          'tsx',
          'src/entrypoints/api/server.ts',
        ],
        { environment: runtimeEnvironment, logName: 'canary-runtime-api' },
      );
      children.push(api);
      primaryChild = api;
      primaryEnvironment = runtimeEnvironment;
      await waitForHttp(`${apiBaseUrl}/health/ready`, readyTimeoutMs, {
        child: api,
        environment: runtimeEnvironment,
        label: 'runtime canary API',
      });
      commandEnvironment = {
        ...runtimeEnvironment,
        AGENT_SERVER_BASE_URL: apiBaseUrl,
        AGENT_SERVER_SERVICE_TOKEN:
          runtimeEnvironment.AGENT_SERVER_SERVICE_TOKEN?.trim() ||
          LOCAL_SERVICE_TOKEN,
        AGENT_SERVER_WORKSPACE_ID:
          runtimeEnvironment.AGENT_SERVER_WORKSPACE_ID?.trim() ||
          LOCAL_WORKSPACE_ID,
        ...(kind === 'team-registry-work' &&
        !runtimeEnvironment.SMOKE_OUTPUT_FILE?.trim()
          ? { SMOKE_OUTPUT_FILE: '.local/test-runs/team-registry-work.ndjson' }
          : {}),
        ...(kind === 'agent-team'
          ? { AGENT_TEAM_SMOKE_TIMEOUT_MS: '900000' }
          : {}),
      };
      await runCommand('node', runtimeSmokeCommand, {
        environment: commandEnvironment,
        cwd: repositoryRoot,
        abortOn: {
          child: api,
          environment: runtimeEnvironment,
          label: 'runtime canary API',
        },
      });
      return;
    }

    const apiPort = canaryPort(loaded, 'PORT', 3000);
    await assertCanaryPortFree('golden-path API', apiPort);
    await assertCanaryPortFree('golden-path web', 3001);
    const readyTimeoutMs = canaryReadyTimeout(loaded);
    const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
    await rm(webBootstrapEnvPath, { force: true });
    const dev = spawnOwned(
      'node',
      ['--import', 'tsx', 'tooling/dev/start.ts', 'runtime'],
      { environment: loaded, logName: 'canary-golden-path-dev' },
    );
    children.push(dev);
    primaryChild = dev;
    primaryEnvironment = loaded;
    await waitForHttp(`${apiBaseUrl}/health/ready`, readyTimeoutMs, {
      child: dev,
      environment: loaded,
      label: 'golden-path dev',
    });
    await waitForHttp('http://127.0.0.1:3001', readyTimeoutMs, {
      child: dev,
      environment: loaded,
      label: 'golden-path dev',
    });
    commandEnvironment = hostWebEnvironment({
      ...loaded,
      AGENT_SERVER_BASE_URL: apiBaseUrl,
      AGENT_SERVER_SERVICE_TOKEN:
        loaded.AGENT_SERVER_SERVICE_TOKEN?.trim() || LOCAL_SERVICE_TOKEN,
      AGENT_SERVER_WORKSPACE_ID:
        loaded.AGENT_SERVER_WORKSPACE_ID?.trim() || LOCAL_WORKSPACE_ID,
      WEB_E2E_BASE_URL:
        loaded.WEB_E2E_BASE_URL?.trim() || 'http://web.localhost:3001',
      WEB_E2E_RESOLVE_HOST: loaded.WEB_E2E_RESOLVE_HOST?.trim() || '127.0.0.1',
      WEB_E2E_PROVIDER:
        loaded.WEB_E2E_PROVIDER?.trim() ||
        loaded.PASEO_PROVIDER?.trim() ||
        'claude',
      WEB_E2E_MODEL:
        loaded.WEB_E2E_MODEL?.trim() ||
        loaded.PASEO_MODEL?.trim() ||
        'opencode-go/deepseek-v4-flash',
    });
    await runCommand(
      'pnpm',
      [
        'exec',
        'vitest',
        'run',
        '--config',
        'vitest.e2e.config.ts',
        'e2e/web-product-session.e2e.test.ts',
      ],
      {
        environment: commandEnvironment,
        cwd: repositoryRoot,
        abortOn: {
          child: dev,
          environment: loaded,
          label: 'golden-path dev',
        },
      },
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const logPath = primaryChild && ownedChildLogPath(primaryChild);
    if (logPath && !errorMessage.includes('\nlog tail:\n')) {
      let tail = '[runtime log is unavailable]';
      try {
        tail = await readRuntimeLogTail(logPath, primaryEnvironment ?? loaded);
      } catch {
        // Preserve the primary failure if the diagnostic log cannot be read.
      }
      throw new Error(
        `${errorMessage}\ncanary primary child: log=${logPath}\nlog tail:\n${tail}`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    await stopOwned(children);
    if (kind === 'golden-path') await rm(webBootstrapEnvPath, { force: true });
  }
}

runHostCanary(parseKind(process.argv[2])).catch((error: unknown) => {
  process.stderr.write(
    `canary failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
