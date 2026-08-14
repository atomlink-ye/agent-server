import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  inspectLocalEnvironment,
  localEnvironmentRepositoryRoot,
  startLocalEnvironment,
} from './lifecycle.js';
import { parseLocalEnvironmentName, resolveLocalEnvironment } from './profiles.js';
import type { LocalEnvironmentState, RuntimeOverrides } from './types.js';

const statePath = resolve(
  localEnvironmentRepositoryRoot,
  '.local/environment-state.json',
);

function parseRuntimeOverrides(args: string[]): RuntimeOverrides | undefined {
  const result: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag !== '--provider' && flag !== '--model' && flag !== '--adapter') {
      throw new Error(`unknown environment option: ${flag}`);
    }
    const value = args[index + 1]?.trim();
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    result[flag.slice(2)] = value;
    index += 1;
  }
  return Object.keys(result).length > 0 ? (result as RuntimeOverrides) : undefined;
}

async function saveState(state: LocalEnvironmentState): Promise<void> {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function loadState(): Promise<LocalEnvironmentState> {
  try {
    return JSON.parse(await readFile(statePath, 'utf8')) as LocalEnvironmentState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('no local environment is recorded; run `pnpm env -- up <profile>` first');
    }
    throw error;
  }
}

async function main(args = process.argv.slice(2)): Promise<void> {
  const [command = 'info', profileValue, ...rest] = args;
  if (command === 'up') {
    if (!profileValue) throw new Error('usage: pnpm env -- up <profile>');
    const profile = parseLocalEnvironmentName(profileValue);
    const runtimeOverrides = parseRuntimeOverrides(rest);
    const handle = await startLocalEnvironment({
      profile,
      ...(runtimeOverrides ? { runtimeOverrides } : {}),
      inheritOutput: true,
    });
    await saveState(handle.state);
    process.stdout.write(`${JSON.stringify({ state: handle.state, urls: handle.urls }, null, 2)}\n`);
    return;
  }
  if (command === 'down') {
    const state = await loadState();
    const profile = await resolveLocalEnvironment(state.profile, {
      overrides: state.runtimeOverrides,
    });
    if (profile.compose.files.length > 0) {
      const handle = await startLocalEnvironment({
        profile: state.profile,
        projectName: state.projectName,
        testMode: state.testMode,
        runtimeOverrides: state.runtimeOverrides,
        inheritOutput: false,
      });
      await handle.stop();
    }
    await rm(statePath, { force: true });
    return;
  }
  if (command === 'info') {
    if (profileValue) {
      const profile = await resolveLocalEnvironment(parseLocalEnvironmentName(profileValue));
      process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`);
      return;
    }
    const state = await loadState();
    process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
    await inspectLocalEnvironment(state);
    return;
  }
  throw new Error('usage: pnpm env -- <up PROFILE|down|info [PROFILE]>');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
