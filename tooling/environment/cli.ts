import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { executeCommand } from './compose.js';
import {
  inspectLocalEnvironment,
  localEnvironmentRepositoryRoot,
  startLocalEnvironment,
  stopLocalEnvironment,
} from './lifecycle.js';
import {
  parseLocalEnvironmentName,
  resolveLocalEnvironment,
} from './profiles.js';
import {
  createTestRunDirectory,
  removeTestRunDirectory,
} from './run-directory.js';
import type {
  LocalEnvironmentState,
  LocalEnvironmentUrls,
  RuntimeOverrides,
} from './types.js';

const statePath = resolve(
  localEnvironmentRepositoryRoot,
  '.local/environment-state.json',
);

function splitRunArguments(args: string[]): {
  readonly flags: string[];
  readonly command: string[];
} {
  const separator = args.indexOf('--');
  if (separator === -1) {
    throw new Error(
      'usage: pnpm local-env run <profile> [--provider X --model Y --adapter X] -- <command...>',
    );
  }
  const command = args.slice(separator + 1);
  if (command.length === 0)
    throw new Error('environment run requires a command after --');
  return { flags: args.slice(0, separator), command };
}

function parseRuntimeOverrides(args: string[]): RuntimeOverrides | undefined {
  const result: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag !== '--provider' && flag !== '--model' && flag !== '--adapter') {
      throw new Error(`unknown environment option: ${flag}`);
    }
    const value = args[index + 1]?.trim();
    if (!value || value.startsWith('--'))
      throw new Error(`${flag} requires a value`);
    result[flag.slice(2)] = value;
    index += 1;
  }
  return Object.keys(result).length > 0
    ? (result as RuntimeOverrides)
    : undefined;
}

async function saveState(state: LocalEnvironmentState): Promise<void> {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function loadState(): Promise<LocalEnvironmentState> {
  try {
    return JSON.parse(
      await readFile(statePath, 'utf8'),
    ) as LocalEnvironmentState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        'no local environment is recorded; run `pnpm local-env up <profile>` first',
      );
    }
    throw error;
  }
}

function commandEnvironment(
  base: NodeJS.ProcessEnv,
  urls: LocalEnvironmentUrls,
  runDirectory: string,
): NodeJS.ProcessEnv {
  return {
    ...base,
    AGENT_SERVER_TEST_RUN_DIR: runDirectory,
    ...(urls.postgres
      ? {
          DATABASE_URL: urls.postgres,
          POSTGRES_URL: urls.postgres,
          POSTGRES_ADMIN_URL: urls.postgres,
        }
      : {}),
    ...(urls.api
      ? {
          AGENT_SERVER_BASE_URL: urls.api,
          AGENT_SERVER_SERVICE_TOKEN:
            base.AGENT_SERVER_SERVICE_TOKEN ?? 'token-local-dev',
          AGENT_SERVER_WORKSPACE_ID:
            base.AGENT_SERVER_WORKSPACE_ID ??
            '00000000-0000-4000-8000-000000000001',
        }
      : {}),
  };
}

async function runInEnvironment(
  profileValue: string | undefined,
  args: string[],
): Promise<void> {
  if (!profileValue)
    throw new Error('usage: pnpm local-env run <profile> -- <command...>');
  const profile = parseLocalEnvironmentName(profileValue);
  const { flags, command } = splitRunArguments(args);
  const runtimeOverrides = parseRuntimeOverrides(flags);
  const run = await createTestRunDirectory();
  const keepFailed = process.env.TEST_KEEP_FAILED === '1';
  let handle: Awaited<ReturnType<typeof startLocalEnvironment>> | undefined;
  let failed = false;
  const startedAt = Date.now();
  const progress = (event: string, details: Record<string, unknown> = {}) =>
    process.stdout.write(
      `${JSON.stringify({
        event: 'local_environment_progress',
        stage: event,
        profile,
        elapsed_ms: Date.now() - startedAt,
        ...details,
      })}\n`,
    );
  try {
    progress('starting');
    const heartbeat = setInterval(() => progress('starting'), 10_000);
    heartbeat.unref();
    const environmentStartedAt = Date.now();
    try {
      handle = await startLocalEnvironment({
        profile,
        testMode: true,
        projectName: `agent-server-run-${run.id}`,
        runDirectory: run.path,
        ...(runtimeOverrides ? { runtimeOverrides } : {}),
        inheritOutput: false,
      });
    } finally {
      clearInterval(heartbeat);
    }
    progress('ready', { startup_ms: Date.now() - environmentStartedAt });
    progress('command_starting', { command: command[0] });
    await executeCommand({
      command: command[0]!,
      args: command.slice(1),
      environment: commandEnvironment(process.env, handle.urls, run.path),
      logPath: resolve(run.path, 'command.log'),
      inheritOutput: true,
    });
    progress('command_completed');
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    let stopError: unknown;
    try {
      if (handle) progress('stopping');
      await handle?.stop();
      if (handle) progress('stopped');
    } catch (error) {
      stopError = error;
      failed = true;
    }
    if (!failed || !keepFailed) await removeTestRunDirectory(run);
    else process.stderr.write(`retained failed test run: ${run.path}\n`);
    if (stopError) throw stopError;
  }
}

async function main(args = process.argv.slice(2)): Promise<void> {
  const [command = 'info', profileValue, ...rest] = args;
  if (command === 'run') {
    await runInEnvironment(profileValue, rest);
    return;
  }
  if (command === 'up') {
    if (!profileValue) throw new Error('usage: pnpm local-env up <profile>');
    const profile = parseLocalEnvironmentName(profileValue);
    const runtimeOverrides = parseRuntimeOverrides(rest);
    const handle = await startLocalEnvironment({
      profile,
      ...(runtimeOverrides ? { runtimeOverrides } : {}),
      inheritOutput: true,
    });
    await saveState(handle.state);
    process.stdout.write(
      `${JSON.stringify({ state: handle.state, urls: handle.urls }, null, 2)}\n`,
    );
    return;
  }
  if (command === 'down') {
    if (profileValue) throw new Error('usage: pnpm local-env down');
    const state = await loadState();
    await stopLocalEnvironment(state, { inheritOutput: true });
    await rm(statePath, { force: true });
    return;
  }
  if (command === 'info') {
    if (profileValue) {
      const profile = await resolveLocalEnvironment(
        parseLocalEnvironmentName(profileValue),
      );
      process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`);
      return;
    }
    const state = await loadState();
    process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
    await inspectLocalEnvironment(state);
    return;
  }
  throw new Error(
    'usage: pnpm local-env <up PROFILE|down|info [PROFILE]|run PROFILE -- COMMAND...>',
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
