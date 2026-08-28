import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LOCAL_SERVICE_TOKEN,
  LOCAL_WORKSPACE_ID,
  hostFixtureRuntimeEnvironment,
  hostRuntimeEnvironment,
  hostWebEnvironment,
  canConnectTcp,
  isPortFree,
  loadLocalDotEnv,
  localServiceAccountsJson,
  ownedChildLogPath,
  prepareHostNativeEnvironment,
  readPGliteState,
  readRuntimeLogTail,
  repositoryRoot,
  resolvePGlitePaths,
  runCommand,
  spawnOwned,
  stopOwned,
  waitForHttp,
} from './host-native.js';
import { setupProviders } from './setup-providers.js';
import { canaryReadinessTimeout } from './readiness-timeout.js';

const fixtureBrowserFiles = [
  'e2e/web-product-golden-path.e2e.test.ts',
  'e2e/web-product-session.e2e.test.ts',
] as const;

export type CanaryKind =
  | 'runtime'
  | 'golden-path'
  | 'fixture-browser'
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

async function fixtureBootstrapEnvironment(
  environment: NodeJS.ProcessEnv,
): Promise<NodeJS.ProcessEnv> {
  const configuredUrl =
    environment.DATABASE_URL?.trim() || environment.POSTGRES_URL?.trim();
  if (configuredUrl) return environment;
  const { statePath } = resolvePGlitePaths(environment);
  const state = await readPGliteState(statePath);
  if (!state)
    throw new Error(
      'fixture-browser could not find the resolved PGlite database for web bootstrap.',
    );
  return {
    ...environment,
    DATABASE_URL: state.url,
    POSTGRES_URL: state.url,
    POSTGRES_ADMIN_URL: state.url,
  };
}

type FixturePGliteOwnership = Readonly<{
  readonly pid: number;
  readonly statePath: string;
  readonly dataPath: string;
  readonly port: number;
  readonly ownerToken: string;
}>;

async function stopFixturePGlite(
  ownership: FixturePGliteOwnership | undefined,
): Promise<void> {
  if (!ownership) return;
  const state = await readPGliteState(ownership.statePath);
  if (
    !state ||
    state.pid !== ownership.pid ||
    state.port !== ownership.port ||
    state.dataPath !== ownership.dataPath ||
    state.ownerToken !== ownership.ownerToken ||
    !(await canConnectTcp(state.host, state.port))
  )
    return;
  try {
    process.kill(state.pid, 'SIGTERM');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (!(await canConnectTcp(state.host, state.port))) {
      await unlink(ownership.statePath).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      });
      return;
    }
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error(
    `fixture-browser PGlite child ${ownership.pid} did not stop on ${state.host}:${state.port}.`,
  );
}

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

async function fixturePGlitePort(): Promise<number> {
  for (let port = 55_433; port <= 55_532; port += 1) {
    if (await isPortFree(port)) return port;
  }
  throw new Error('fixture-browser could not find a free PGlite port.');
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
    value === 'fixture-browser' ||
    value === 'agent-team' ||
    value === 'team-registry-work' ||
    value === 'user-defined-team-work'
  )
    return value;
  throw new Error(
    'usage: run-canary.ts <runtime|golden-path|fixture-browser|agent-team|team-registry-work|user-defined-team-work>',
  );
}

export { canaryReadinessTimeout as canaryReadyTimeout } from './readiness-timeout.js';

export async function runHostCanary(
  kind: CanaryKind,
  environment: NodeJS.ProcessEnv = process.env,
  requestedBrowserFiles?: readonly string[],
): Promise<void> {
  const children: ChildProcess[] = [];
  const lifecycle = createCanarySignalLifecycle(children);
  let loaded = environment;
  let primaryChild: ChildProcess | undefined;
  let primaryEnvironment: NodeJS.ProcessEnv | undefined;
  let goldenApiPort: number | undefined;
  let fixturePGliteRoot: string | undefined;
  let fixturePGliteOwnership: FixturePGliteOwnership | undefined;
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

    const fixtureBrowser = kind === 'fixture-browser';
    if (
      fixtureBrowser &&
      (requestedBrowserFiles === undefined ||
        requestedBrowserFiles.length !== fixtureBrowserFiles.length ||
        requestedBrowserFiles.some(
          (file, index) => file !== fixtureBrowserFiles[index],
        ))
    )
      throw new Error(
        `fixture-browser requires both browser journeys: ${fixtureBrowserFiles.join(', ')}`,
      );
    const apiPort = canaryPort(loaded, 'PORT', 3000);
    goldenApiPort = apiPort;
    await assertCanaryPortFree(
      fixtureBrowser ? 'fixture-browser API' : 'golden-path API',
      apiPort,
    );
    await assertCanaryPortFree(
      fixtureBrowser ? 'fixture-browser web' : 'golden-path web',
      3001,
    );
    throwIfCanaryInterrupted(lifecycle);
    const readyTimeoutMs = canaryReadinessTimeout(loaded);
    const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
    await rm(webBootstrapEnvPath, { force: true });
    throwIfCanaryInterrupted(lifecycle);
    const fixtureRunRoot = fixtureBrowser
      ? await mkdtemp(
          join(repositoryRoot, '.local/dev-runtime/fixture-browser-'),
        )
      : undefined;
    fixturePGliteRoot = fixtureRunRoot;
    const fixtureOwnerToken = fixtureBrowser ? randomUUID() : undefined;
    const fixturePort = fixtureBrowser ? await fixturePGlitePort() : undefined;
    const devEnvironment: NodeJS.ProcessEnv = {
      ...(fixtureBrowser
        ? hostFixtureRuntimeEnvironment(loaded, 'baseline-completion')
        : loaded),
      HOST_NATIVE_WATCH: '0',
      WEB_BOOTSTRAP_EMPTY_PRODUCT: '1',
      CANARY_READY_TIMEOUT_MS: String(readyTimeoutMs),
      ...(fixtureBrowser
        ? {
            PGLITE_STATE_PATH: join(fixtureRunRoot!, 'pglite.json'),
            PGLITE_DATA_PATH: join(fixtureRunRoot!, 'pglite'),
            PGLITE_PORT: String(fixturePort),
            PGLITE_OWNER_TOKEN: fixtureOwnerToken,
          }
        : {}),
    };
    const dev = spawnOwned(
      'node',
      [
        '--import',
        'tsx',
        'tooling/dev/start.ts',
        fixtureBrowser ? 'fixture' : 'runtime',
      ],
      {
        environment: devEnvironment,
        logName: fixtureBrowser
          ? 'fixture-browser-dev'
          : 'canary-golden-path-dev',
      },
    );
    lifecycle.register(dev);
    primaryChild = dev;
    primaryEnvironment = devEnvironment;
    await waitForHttp(`${apiBaseUrl}/health/ready`, readyTimeoutMs, {
      child: dev,
      environment: devEnvironment,
      label: fixtureBrowser ? 'fixture-browser dev' : 'golden-path dev',
    });
    throwIfCanaryInterrupted(lifecycle);
    await waitForHttp('http://127.0.0.1:3001', readyTimeoutMs, {
      child: dev,
      environment: devEnvironment,
      label: fixtureBrowser ? 'fixture-browser dev' : 'golden-path dev',
    });
    if (fixtureBrowser) {
      const paths = resolvePGlitePaths(devEnvironment);
      const state = await readPGliteState(paths.statePath);
      const port = fixturePort!;
      if (
        !state ||
        state.dataPath !== paths.dataPath ||
        state.port !== port ||
        state.ownerToken !== fixtureOwnerToken ||
        !(await canConnectTcp(state.host, state.port))
      )
        throw new Error(
          'fixture-browser could not verify ownership of its spawned PGlite child.',
        );
      fixturePGliteOwnership = {
        pid: state.pid,
        statePath: paths.statePath,
        dataPath: paths.dataPath,
        port,
        ownerToken: fixtureOwnerToken!,
      };
    }
    throwIfCanaryInterrupted(lifecycle);
    commandEnvironment = hostWebEnvironment({
      ...(fixtureBrowser ? devEnvironment : loaded),
      AGENT_SERVER_BASE_URL: apiBaseUrl,
      AGENT_SERVER_SERVICE_TOKEN:
        loaded.AGENT_SERVER_SERVICE_TOKEN?.trim() || LOCAL_SERVICE_TOKEN,
      AGENT_SERVER_WORKSPACE_ID:
        loaded.AGENT_SERVER_WORKSPACE_ID?.trim() || LOCAL_WORKSPACE_ID,
      WEB_E2E_BASE_URL:
        loaded.WEB_E2E_BASE_URL?.trim() || 'http://web.localhost:3001',
      WEB_BOOTSTRAP_EMPTY_PRODUCT: '1',
      WEB_E2E_RESOLVE_HOST: loaded.WEB_E2E_RESOLVE_HOST?.trim() || '127.0.0.1',
      ...(fixtureBrowser
        ? { WEB_E2E_FIXTURE_REPLAY: '1' }
        : {
            WEB_E2E_PROVIDER:
              loaded.WEB_E2E_PROVIDER?.trim() ||
              loaded.PASEO_PROVIDER?.trim() ||
              'claude',
            WEB_E2E_MODEL:
              loaded.WEB_E2E_MODEL?.trim() ||
              loaded.PASEO_MODEL?.trim() ||
              'opencode-go/deepseek-v4-flash',
          }),
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
          label: fixtureBrowser ? 'fixture-browser dev' : 'golden-path dev',
          healthUrl: `${apiBaseUrl}/health/ready`,
        },
      },
    );
    throwIfCanaryInterrupted(lifecycle);
    // Keep the same runtime alive while switching from the empty authoring
    // surface to the normal seeded ProductSession fixture world.
    const bootstrapEnvironment = fixtureBrowser
      ? await fixtureBootstrapEnvironment(devEnvironment)
      : devEnvironment;
    await runCommand('node', ['scripts/dev/web-bootstrap.mjs'], {
      environment: {
        ...bootstrapEnvironment,
        AGENT_SERVER_BASE_URL: apiBaseUrl,
        WEB_BOOTSTRAP_EMPTY_PRODUCT: '0',
        WEB_BOOTSTRAP_SKIP_WORK: '0',
      },
      cwd: repositoryRoot,
      abortOn: {
        child: dev,
        environment: devEnvironment,
        label: fixtureBrowser ? 'fixture-browser dev' : 'golden-path dev',
        healthUrl: `${apiBaseUrl}/health/ready`,
      },
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
        environment: {
          ...commandEnvironment,
          WEB_BOOTSTRAP_EMPTY_PRODUCT: '0',
        },
        cwd: repositoryRoot,
        abortOn: {
          child: dev,
          environment: devEnvironment,
          label: fixtureBrowser ? 'fixture-browser dev' : 'golden-path dev',
          healthUrl: `${apiBaseUrl}/health/ready`,
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
    if (kind === 'golden-path' || kind === 'fixture-browser') {
      await rm(webBootstrapEnvPath, { force: true });
      const busy = await waitForGoldenPortsIdle(goldenApiPort ?? 3000);
      if (busy.length > 0) {
        cleanupError = new Error(
          `${kind} left ports in use: ${busy.join(', ')}${
            cleanupError instanceof Error ? `; ${cleanupError.message}` : ''
          }`,
        );
      }
    }
    if (kind === 'fixture-browser') {
      try {
        await stopFixturePGlite(fixturePGliteOwnership);
      } catch (error) {
        cleanupError = error;
      }
      try {
        if (fixturePGliteRoot)
          await rm(fixturePGliteRoot, { recursive: true, force: true });
      } catch (error) {
        cleanupError ??= error;
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
  runHostCanary(
    parseKind(process.argv[2]),
    process.env,
    process.argv.slice(3),
  ).catch((error: unknown) => {
    process.stderr.write(
      `canary failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
