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
  if (profile === 'core' || profile === 'runtime' || profile === 'full' || profile === 'acceptance') {
    return {
      postgres: await freePort(),
      api: await freePort(),
      // The shared Compose override is parsed as a whole even when the web
      // service is not selected, so every infrastructure-backed test run
      // supplies a collision-free value for its interpolation.
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
            state.profile === 'full' || state.profile === 'acceptance'
          ? { api: 'http://127.0.0.1:3000' }
          : {}),
    ...((state.profile === 'full' || state.profile === 'acceptance') && state.ports.web
      ? { web: `http://127.0.0.1:${state.ports.web}` }
      : !state.testMode && (state.profile === 'full' || state.profile === 'acceptance')
        ? { web: 'http://127.0.0.1:3001' }
        : {}),
  };
}

function extraComposeFiles(state: LocalEnvironmentState): readonly string[] {
  return state.testMode && state.profile !== 'postgres'
    ? ['compose.test-ports.yaml']
    : [];
}

// 🔴 渲染 Compose 配置必须走【和实际起栈完全相同】的 command + args + environment。
// 早先这里只返回 .args 并丢掉 .command：compose.ts:61-65 在 transport=repository 时
// command 是 scripts/dev/docker-compose wrapper（它会 source provider defaults 并建 volume 环境），
// 丢掉它意味着 ① 拼出的 `docker -p ... -f ... config` 连子命令都不对，
// ② 渲染绕过 wrapper，与实际启动的 effective 环境不同（层数相同也没用）。
// environment 也必须由 environmentFor 产出：调用方另拼一份就构成【判据自证】——
// 渲染方自己补上 environmentFor 漏掉的端口变量，判据就再也发现不了 R3-73 那类遗漏。
export async function composeInvocationForLocalEnvironment(
  state: LocalEnvironmentState,
  baseEnvironment: NodeJS.ProcessEnv = process.env,
): Promise<{
  readonly command: string;
  readonly args: readonly string[];
  readonly environment: NodeJS.ProcessEnv;
}> {
  const profile = await resolveLocalEnvironment(state.profile, {
    environment: baseEnvironment,
    overrides: state.runtimeOverrides,
  });
  const invocation = composeInvocation(
    profile,
    state.projectName,
    extraComposeFiles(state),
  );
  return {
    command: invocation.command,
    args: invocation.args,
    environment: environmentFor(baseEnvironment, state, profile.runtime),
  };
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
      // 🔴 acceptance 不整体删卷：卷里存着从镜像拷出来的 node_modules，删掉就等于
      // 每次重跑都要再拷一遍整棵树（实测冷卷上 UI 要 546 秒才应答）。
      // ⛔ 但【数据卷必须删】—— 留着 postgres-data 会让下一次运行撞上
      //   FATAL: the database system is not yet accepting connections
      //   DETAIL: Consistent recovery state has not been yet reached.
      // 每次验收要的是干净的数据库 + 热的依赖，这是两件事，⛔ 不要一起处理。
      ...(state.testMode && state.profile !== 'acceptance' ? ['--volumes'] : []),
    ],
    environment: environmentFor(
      options.environment ?? process.env,
      state,
      profile.runtime,
    ),
    ...(logPath ? { logPath } : {}),
    inheritOutput: options.inheritOutput ?? !state.testMode,
  });

  // 🔴 acceptance 保留依赖卷、但必须丢掉【数据】卷。留着 postgres-data，下一次运行
  // 会在 postgres 还在 WAL 恢复时就去连它：
  //   FATAL: the database system is not yet accepting connections
  //   DETAIL: Consistent recovery state has not been yet reached.
  // ⛔ 不许用"等久一点"来绕开 —— 验收要的是一个【干净】的数据库，不是一个恢复完的旧库。
  if (state.testMode && state.profile === 'acceptance') {
    for (const volume of ['postgres-data', 'local-state', 'paseo-runtime-state']) {
      await (options.executor ?? executeCommand)({
        command: 'docker',
        args: ['volume', 'rm', '-f', `${state.projectName}_${volume}`],
        environment: options.environment ?? process.env,
        ...(logPath ? { logPath } : {}),
        inheritOutput: false,
      }).catch(() => undefined);
    }
  }
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
      // Acceptance runs in a prebuilt sandbox image. Its dependency stamp is
      // verified by the container entrypoint, so rebuilding here only turns
      // environment setup into an unbounded Docker build.
      ...(profile.compose.transport === 'repository' && options.profile !== 'acceptance' ? ['--build'] : []),
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
