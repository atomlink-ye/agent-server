import { createServer } from 'node:net';
import { resolve } from 'node:path';

import {
  composeInvocation,
  executeCommand,
  type CommandExecutor,
} from './compose.js';
import { repositoryRoot, resolveLocalEnvironment } from './profiles.js';
import type {
  EnvironmentPorts,
  LocalEnvironmentName,
  LocalEnvironmentState,
  LocalEnvironmentUrls,
  RuntimeOverrides,
} from './types.js';

export interface StartLocalEnvironmentOptions {
  readonly profile: LocalEnvironmentName;
  readonly projectName?: string;
  readonly testMode?: boolean;
  readonly runtimeOverrides?: RuntimeOverrides;
  readonly runDirectory?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly executor?: CommandExecutor;
  readonly inheritOutput?: boolean;
}

export interface StopLocalEnvironmentOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly executor?: CommandExecutor;
  readonly runDirectory?: string;
  readonly inheritOutput?: boolean;
}

export interface LocalEnvironmentHandle {
  readonly state: LocalEnvironmentState;
  readonly urls: LocalEnvironmentUrls;
  stop(): Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('failed to allocate a local TCP port'));
        return;
      }
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });
}

async function resolvePorts(
  profile: LocalEnvironmentName,
  testMode: boolean,
): Promise<EnvironmentPorts> {
  if (profile === 'postgres') return { postgres: await freePort() };
  if (!testMode) return {};
  if (profile === 'core' || profile === 'runtime') {
    return { postgres: await freePort(), api: await freePort() };
  }
  if (profile === 'full') {
    return {
      postgres: await freePort(),
      api: await freePort(),
      web: await freePort(),
    };
  }
  return {};
}

function environmentFor(
  base: NodeJS.ProcessEnv,
  state: LocalEnvironmentState,
  runtime: {
    readonly adapter: string;
    readonly provider?: string;
    readonly model?: string;
  },
): NodeJS.ProcessEnv {
  return {
    ...base,
    RUNTIME_ADAPTER: runtime.adapter,
    ...(runtime.provider ? { PASEO_PROVIDER: runtime.provider } : {}),
    ...(runtime.model ? { PASEO_MODEL: runtime.model } : {}),
    ...(state.ports.postgres
      ? { AGENT_SERVER_TEST_POSTGRES_PORT: String(state.ports.postgres) }
      : {}),
    ...(state.ports.api
      ? { AGENT_SERVER_TEST_API_PORT: String(state.ports.api) }
      : {}),
    ...(state.ports.web
      ? { AGENT_SERVER_TEST_WEB_PORT: String(state.ports.web) }
      : {}),
  };
}

function urlsFor(state: LocalEnvironmentState): LocalEnvironmentUrls {
  return {
    ...(state.ports.postgres
      ? {
          postgres: `postgresql://agent:agent@127.0.0.1:${state.ports.postgres}/agent_server`,
        }
      : {}),
    ...(state.ports.api
      ? { api: `http://127.0.0.1:${state.ports.api}` }
      : state.testMode
        ? {}
        : state.profile === 'core' ||
            state.profile === 'runtime' ||
            state.profile === 'full'
          ? { api: 'http://127.0.0.1:3000' }
          : {}),
    ...(state.ports.web
      ? { web: `http://127.0.0.1:${state.ports.web}` }
      : !state.testMode && state.profile === 'full'
        ? { web: 'http://127.0.0.1:3001' }
        : {}),
  };
}

function extraComposeFiles(state: LocalEnvironmentState): readonly string[] {
  return state.testMode && state.profile !== 'postgres'
    ? ['compose.test-ports.yaml']
    : [];
}

export async function stopLocalEnvironment(
  state: LocalEnvironmentState,
  options: StopLocalEnvironmentOptions = {},
): Promise<void> {
  const profile = await resolveLocalEnvironment(state.profile, {
    environment: options.environment,
    overrides: state.runtimeOverrides,
  });
  if (profile.compose.files.length === 0) return;
  const invocation = composeInvocation(
    profile,
    state.projectName,
    extraComposeFiles(state),
  );
  const logPath = options.runDirectory
    ? resolve(options.runDirectory, 'compose.log')
    : undefined;
  await (options.executor ?? executeCommand)({
    command: invocation.command,
    args: [
      ...invocation.args,
      'down',
      '--remove-orphans',
      ...(state.testMode ? ['--volumes'] : []),
    ],
    environment: environmentFor(
      options.environment ?? process.env,
      state,
      profile.runtime,
    ),
    ...(logPath ? { logPath } : {}),
    inheritOutput: options.inheritOutput ?? !state.testMode,
  });
}

export async function startLocalEnvironment(
  options: StartLocalEnvironmentOptions,
): Promise<LocalEnvironmentHandle> {
  const executor = options.executor ?? executeCommand;
  const testMode = options.testMode ?? false;
  const profile = await resolveLocalEnvironment(options.profile, {
    environment: options.environment,
    overrides: options.runtimeOverrides,
  });
  const ports = await resolvePorts(options.profile, testMode);
  const state: LocalEnvironmentState = {
    profile: options.profile,
    projectName:
      options.projectName ??
      (testMode
        ? `agent-server-test-${Date.now().toString(36)}`
        : `agent-server-${options.profile}`),
    testMode,
    ports,
    ...(options.runtimeOverrides
      ? { runtimeOverrides: options.runtimeOverrides }
      : {}),
  };
  if (profile.compose.files.length === 0) {
    return { state, urls: urlsFor(state), stop: async () => undefined };
  }
  const invocation = composeInvocation(
    profile,
    state.projectName,
    extraComposeFiles(state),
  );
  const environment = environmentFor(
    options.environment ?? process.env,
    state,
    profile.runtime,
  );
  const logPath = options.runDirectory
    ? resolve(options.runDirectory, 'compose.log')
    : undefined;
  await executor({
    command: invocation.command,
    args: [
      ...invocation.args,
      'up',
      ...(profile.compose.transport === 'repository' ? ['--build'] : []),
      '-d',
      '--wait',
      ...profile.services,
    ],
    environment,
    ...(logPath ? { logPath } : {}),
    inheritOutput: options.inheritOutput ?? !testMode,
  });
  return {
    state,
    urls: urlsFor(state),
    stop: async () =>
      stopLocalEnvironment(state, {
        environment,
        executor,
        ...(options.runDirectory ? { runDirectory: options.runDirectory } : {}),
        inheritOutput: options.inheritOutput ?? !testMode,
      }),
  };
}

export async function inspectLocalEnvironment(
  state: LocalEnvironmentState,
  options: {
    readonly executor?: CommandExecutor;
    readonly environment?: NodeJS.ProcessEnv;
  } = {},
): Promise<void> {
  const profile = await resolveLocalEnvironment(state.profile, {
    environment: options.environment,
    overrides: state.runtimeOverrides,
  });
  if (profile.compose.files.length === 0) return;
  const invocation = composeInvocation(
    profile,
    state.projectName,
    extraComposeFiles(state),
  );
  await (options.executor ?? executeCommand)({
    command: invocation.command,
    args: [...invocation.args, 'ps'],
    environment: environmentFor(
      options.environment ?? process.env,
      state,
      profile.runtime,
    ),
    inheritOutput: true,
  });
}

export const localEnvironmentRepositoryRoot = repositoryRoot;
