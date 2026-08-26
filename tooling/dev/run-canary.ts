import type { ChildProcess } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
import { canaryReadinessTimeout } from './readiness-timeout.js';

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

type CanarySignal = 'SIGINT' | 'SIGTERM' | 'SIGHUP';

const canarySignalExitCodes: Record<CanarySignal, number> = {
  SIGINT: 130,
  SIGTERM: 143,
  SIGHUP: 129,
};

type CanarySignalLifecycle = Readonly<{
  readonly cleanup: () => Promise<void>;
  readonly register: (child: ChildProcess) => void;
  readonly requestedSignal: () => CanarySignal | undefined;
  readonly signal: Promise<CanarySignal>;
  readonly dispose: () => void;
}>;

export function createCanarySignalLifecycle(
  children: ChildProcess[],
): CanarySignalLifecycle {
  let requestedSignal: CanarySignal | undefined;
  let cleanupPromise: Promise<void> | undefined;
  let cleanupStarted = false;
  let resolveSignal: (signal: CanarySignal) => void = () => undefined;
  const signal = new Promise<CanarySignal>((resolveSignalValue) => {
    resolveSignal = resolveSignalValue;
  });
  const cleanup = (): Promise<void> => {
    cleanupStarted = true;
    cleanupPromise ??= stopOwned([...children]);
    return cleanupPromise;
  };
  const register = (child: ChildProcess): void => {
    children.push(child);
    if (cleanupStarted) {
      const childCleanup = stopOwned([child]);
      cleanupPromise = cleanupPromise
        ? Promise.all([cleanupPromise, childCleanup]).then(() => undefined)
        : childCleanup;
    }
  };
  const handlers = new Map<CanarySignal, () => void>();
  for (const signalName of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    const handler = () => {
      if (requestedSignal) return;
      requestedSignal = signalName;
      process.exitCode = canarySignalExitCodes[signalName];
      resolveSignal(signalName);
      void cleanup().catch(() => undefined);
    };
    handlers.set(signalName, handler);
    process.on(signalName, handler);
  }
  return {
    cleanup,
    register,
    requestedSignal: () => requestedSignal,
    signal,
    dispose: () => {
      for (const [signalName, handler] of handlers) {
        process.removeListener(signalName, handler);
      }
    },
  };
}

function throwIfCanaryInterrupted(lifecycle: CanarySignalLifecycle): void {
  const signal = lifecycle.requestedSignal();
  if (signal) throw new Error(`canary interrupted by ${signal}`);
}

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

async function goldenPortsStillBusy(apiPort: number): Promise<number[]> {
  const busy: number[] = [];
  if (!(await isPortFree(apiPort))) busy.push(apiPort);
  if (!(await isPortFree(3001))) busy.push(3001);
  return busy;
}

async function waitForGoldenPortsIdle(apiPort: number): Promise<number[]> {
  let busy = await goldenPortsStillBusy(apiPort);
  for (let attempt = 0; attempt < 5 && busy.length > 0; attempt += 1) {
    await new Promise<void>((resolveDelay) => {
      setTimeout(resolveDelay, 200);
    });
    busy = await goldenPortsStillBusy(apiPort);
  }
  return busy;
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

export { canaryReadinessTimeout as canaryReadyTimeout } from './readiness-timeout.js';

export async function runHostCanary(
  kind: CanaryKind,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const children: ChildProcess[] = [];
  const lifecycle = createCanarySignalLifecycle(children);
  let loaded = environment;
  let primaryChild: ChildProcess | undefined;
  let primaryEnvironment: NodeJS.ProcessEnv | undefined;
  let goldenApiPort: number | undefined;
  let runError: unknown;
  try {
    loaded = await loadLocalDotEnv(environment);
    throwIfCanaryInterrupted(lifecycle);
    let commandEnvironment: NodeJS.ProcessEnv;
    const runtimeSmokeCommand = runtimeSmokeCommands[kind];
    if (runtimeSmokeCommand) {
      // Runtime compatibility does not need to boot Vite/browser. Start only
      // the host-native API wrapped by the existing Paseo helper, then run one
      // bounded real-provider turn.
      const prepared = await prepareHostNativeEnvironment(loaded);
      throwIfCanaryInterrupted(lifecycle);
      const runtimeEnvironment: NodeJS.ProcessEnv = {
        ...hostRuntimeEnvironment(prepared),
        ...(kind === 'runtime'
          ? {}
          : { SERVICE_ACCOUNTS_JSON: localServiceAccountsJson() }),
      };
      const apiPort = canaryPort(runtimeEnvironment, 'PORT', 3000);
      await assertCanaryPortFree('runtime API', apiPort);
      const readyTimeoutMs = canaryReadinessTimeout(runtimeEnvironment);
      await setupProviders(runtimeEnvironment);
      throwIfCanaryInterrupted(lifecycle);
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
      lifecycle.register(api);
      primaryChild = api;
      primaryEnvironment = runtimeEnvironment;
      await waitForHttp(`${apiBaseUrl}/health/ready`, readyTimeoutMs, {
        child: api,
        environment: runtimeEnvironment,
        label: 'runtime canary API',
      });
      throwIfCanaryInterrupted(lifecycle);
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
          ? {
              AGENT_TEAM_SMOKE_TIMEOUT_MS:
                runtimeEnvironment.AGENT_TEAM_SMOKE_TIMEOUT_MS?.trim() ||
                '300000',
            }
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
      throwIfCanaryInterrupted(lifecycle);
      return;
    }

    const apiPort = canaryPort(loaded, 'PORT', 3000);
    goldenApiPort = apiPort;
    await assertCanaryPortFree('golden-path API', apiPort);
    await assertCanaryPortFree('golden-path web', 3001);
    throwIfCanaryInterrupted(lifecycle);
    const readyTimeoutMs = canaryReadinessTimeout(loaded);
    const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
    await rm(webBootstrapEnvPath, { force: true });
    throwIfCanaryInterrupted(lifecycle);
    const devEnvironment: NodeJS.ProcessEnv = {
      ...loaded,
      HOST_NATIVE_WATCH: '0',
      WEB_BOOTSTRAP_EMPTY_PRODUCT: '1',
      CANARY_READY_TIMEOUT_MS: String(readyTimeoutMs),
    };
    const dev = spawnOwned(
      'node',
      ['--import', 'tsx', 'tooling/dev/start.ts', 'runtime'],
      {
        environment: devEnvironment,
        logName: 'canary-golden-path-dev',
      },
    );
    lifecycle.register(dev);
    primaryChild = dev;
    primaryEnvironment = devEnvironment;
    await waitForHttp(`${apiBaseUrl}/health/ready`, readyTimeoutMs, {
      child: dev,
      environment: devEnvironment,
      label: 'golden-path dev',
    });
    throwIfCanaryInterrupted(lifecycle);
    await waitForHttp('http://127.0.0.1:3001', readyTimeoutMs, {
      child: dev,
      environment: devEnvironment,
      label: 'golden-path dev',
    });
    throwIfCanaryInterrupted(lifecycle);
    commandEnvironment = hostWebEnvironment({
      ...loaded,
      AGENT_SERVER_BASE_URL: apiBaseUrl,
      AGENT_SERVER_SERVICE_TOKEN:
        loaded.AGENT_SERVER_SERVICE_TOKEN?.trim() || LOCAL_SERVICE_TOKEN,
      AGENT_SERVER_WORKSPACE_ID:
        loaded.AGENT_SERVER_WORKSPACE_ID?.trim() || LOCAL_WORKSPACE_ID,
      WEB_E2E_BASE_URL:
        loaded.WEB_E2E_BASE_URL?.trim() || 'http://web.localhost:3001',
      WEB_BOOTSTRAP_EMPTY_PRODUCT: '1',
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
        'e2e/web-product-golden-path.e2e.test.ts',
      ],
      {
        environment: commandEnvironment,
        cwd: repositoryRoot,
        abortOn: {
          child: dev,
          environment: devEnvironment,
          label: 'golden-path dev',
          healthUrl: `${apiBaseUrl}/health/ready`,
        },
      },
    );
    throwIfCanaryInterrupted(lifecycle);
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
      runError = new Error(
        `${errorMessage}\ncanary primary child: log=${logPath}\nlog tail:\n${tail}`,
        { cause: error },
      );
    } else {
      runError = error;
    }
  } finally {
    let cleanupError: unknown;
    try {
      await lifecycle.cleanup();
    } catch (error) {
      cleanupError = error;
    }
    if (kind === 'golden-path') {
      await rm(webBootstrapEnvPath, { force: true });
      const busy = await waitForGoldenPortsIdle(goldenApiPort ?? 3000);
      if (busy.length > 0) {
        cleanupError = new Error(
          `golden-path left ports in use: ${busy.join(', ')}${
            cleanupError instanceof Error ? `; ${cleanupError.message}` : ''
          }`,
        );
      }
    }
    lifecycle.dispose();
    const requestedSignal = lifecycle.requestedSignal();
    if (requestedSignal) {
      process.exitCode = canarySignalExitCodes[requestedSignal];
      if (runError || cleanupError) {
        const details = [runError, cleanupError]
          .filter(Boolean)
          .map((error) =>
            error instanceof Error ? error.message : String(error),
          )
          .join('\n');
        process.stderr.write(
          `canary interrupted by ${requestedSignal}\n${details}\n`,
        );
      }
      return;
    }
    if (runError && cleanupError) {
      throw new Error(
        `${runError instanceof Error ? runError.message : String(runError)}\n${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
        { cause: runError },
      );
    }
    if (runError) throw runError;
    if (cleanupError) throw cleanupError;
  }
}

function isEntrypoint(): boolean {
  return (
    process.argv[1] !== undefined &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

if (isEntrypoint()) {
  runHostCanary(parseKind(process.argv[2])).catch((error: unknown) => {
    process.stderr.write(
      `canary failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
