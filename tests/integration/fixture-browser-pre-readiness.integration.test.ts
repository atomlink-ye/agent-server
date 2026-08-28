import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isPortFree } from '../../tooling/dev/host-native.js';

const fixtureRootPrefix = 'fixture-browser-';

async function fixtureRoots(runtimeDirectory: string): Promise<string[]> {
  return readdir(runtimeDirectory).then(
    (entries) => entries.filter((entry) => entry.startsWith(fixtureRootPrefix)),
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    },
  );
}

async function busyFixturePorts(): Promise<number[]> {
  const ports: number[] = [];
  for (let port = 55_433; port <= 55_532; port += 1) {
    if (!(await isPortFree(port))) ports.push(port);
  }
  return ports;
}

function sanitizedChildEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    SERVICE_ACCOUNTS_JSON: 'not-json',
  };
  for (const name of [
    'DATABASE_URL',
    'POSTGRES_URL',
    'POSTGRES_ADMIN_URL',
    'PGLITE_PORT',
    'PGLITE_STATE_PATH',
    'PGLITE_DATA_PATH',
    'PGLITE_OWNER_TOKEN',
    'PGLITE_HOST',
    'PGLITE_DATABASE',
    'HOST_NATIVE_FORCE_PGLITE',
    'CANARY_REQUIRE_NATIVE_POSTGRES',
  ])
    delete environment[name];
  return environment;
}

async function observesOwnedPGlite(runtimeDirectory: string): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    for (const root of await fixtureRoots(runtimeDirectory)) {
      const statePath = join(runtimeDirectory, root, 'pglite.json');
      try {
        const state = JSON.parse(await readFile(statePath, 'utf8')) as {
          pid?: unknown;
          port?: unknown;
          dataPath?: unknown;
          ownerToken?: unknown;
        };
        if (
          typeof state.pid === 'number' &&
          typeof state.port === 'number' &&
          Number.isInteger(state.port) &&
          state.port >= 55_433 &&
          state.port <= 55_532 &&
          state.dataPath === join(runtimeDirectory, root, 'pglite') &&
          typeof state.ownerToken === 'string' &&
          state.ownerToken.length > 0
        )
          return true;
      } catch {
        // State publication and fixture cleanup race; retry until the deadline.
      }
    }
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  return false;
}

describe('fixture-browser pre-readiness failure', () => {
  it('starts owned PGlite before failing quickly and leaving no residue', async () => {
    const runtimeDirectory = join(process.cwd(), '.local/dev-runtime');
    const rootsBefore = await fixtureRoots(runtimeDirectory);
    const portsBefore = await busyFixturePorts();
    const startedAt = Date.now();
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        'tooling/dev/run-canary.ts',
        'fixture-browser',
        'e2e/web-product-golden-path.e2e.test.ts',
        'e2e/web-product-session.e2e.test.ts',
      ],
      {
        cwd: process.cwd(),
        env: sanitizedChildEnvironment(),
        stdio: 'ignore',
      },
    );
    let exceededDeadline = false;
    const deadline = setTimeout(() => {
      exceededDeadline = true;
      child.kill('SIGTERM');
    }, 15_000);
    const [outcome, pgliteWasObserved] = await Promise.all([
      new Promise<{ code: number | null }>((resolveExit) => {
        child.once('exit', (code) => resolveExit({ code }));
      }),
      observesOwnedPGlite(runtimeDirectory),
    ]);
    clearTimeout(deadline);

    expect(exceededDeadline).toBe(false);
    expect(outcome.code).toBe(1);
    expect(Date.now() - startedAt).toBeLessThan(15_000);
    expect(pgliteWasObserved).toBe(true);
    await expect(fixtureRoots(runtimeDirectory)).resolves.toEqual(rootsBefore);
    await expect(busyFixturePorts()).resolves.toEqual(portsBefore);
  }, 20_000);
});
