import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const canConnectTcp = vi.hoisted(() => vi.fn());
const readPGliteState = vi.hoisted(() => vi.fn());

vi.mock('./host-native.js', async () => {
  const actual =
    await vi.importActual<typeof import('./host-native.js')>(
      './host-native.js',
    );
  return { ...actual, canConnectTcp, readPGliteState };
});

import {
  aggregateCleanupErrors,
  stopFixturePGlite,
  sweepStaleFixtureBrowserRoots,
} from './run-canary.js';
import { isPortFree } from './host-native.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createFixtureRoot(
  runtimeDirectory: string,
  name: string,
): Promise<string> {
  const root = join(runtimeDirectory, name);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  return root;
}

async function busyFixturePorts(): Promise<number[]> {
  const ports: number[] = [];
  for (let port = 55_433; port <= 55_532; port += 1) {
    if (!(await isPortFree(port))) ports.push(port);
  }
  return ports;
}

function pgliteState(
  root: string,
  port: number,
  ownerToken?: string,
  pid = process.pid,
) {
  return {
    kind: 'agent-server-pglite' as const,
    pid,
    host: '127.0.0.1',
    port,
    database: 'postgres',
    url: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
    dataPath: join(root, 'pglite'),
    ...(ownerToken === undefined ? {} : { ownerToken }),
  };
}

describe('fixture-browser stale-root sweep', () => {
  beforeEach(() => {
    canConnectTcp.mockReset();
    readPGliteState.mockReset();
    canConnectTcp.mockResolvedValue(false);
  });

  it('leaves state-less roots but removes a fully identified stopped root', async () => {
    const runtimeDirectory = await mkdtemp(
      join(tmpdir(), 'agent-server-fixture-sweep-'),
    );
    temporaryDirectories.push(runtimeDirectory);
    const withoutState = await createFixtureRoot(
      runtimeDirectory,
      'fixture-browser-no-state',
    );
    const stale = await createFixtureRoot(
      runtimeDirectory,
      'fixture-browser-stale',
    );
    const stalePid = 9_876_543;
    const kill = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === stalePid && signal === 0) {
        const error = new Error('no such process') as NodeJS.ErrnoException;
        error.code = 'ESRCH';
        throw error;
      }
      return true;
    });
    await writeFile(
      join(stale, 'pglite.json'),
      JSON.stringify(pgliteState(stale, 55_531, 'stale-owner-token', stalePid)),
    );

    try {
      await sweepStaleFixtureBrowserRoots(runtimeDirectory);
    } finally {
      kill.mockRestore();
    }

    await expect(readdir(withoutState)).resolves.toEqual([]);
    await expect(readFile(join(stale, 'missing'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(readdir(runtimeDirectory)).resolves.toEqual([
      'fixture-browser-no-state',
    ]);
  });

  it('leaves live, malformed, tokenless, and mismatching roots untouched', async () => {
    const runtimeDirectory = await mkdtemp(
      join(tmpdir(), 'agent-server-fixture-sweep-'),
    );
    temporaryDirectories.push(runtimeDirectory);
    const live = await createFixtureRoot(
      runtimeDirectory,
      'fixture-browser-live',
    );
    const livePort = 55_528;
    canConnectTcp.mockResolvedValueOnce(true);
    await writeFile(
      join(live, 'pglite.json'),
      JSON.stringify(pgliteState(live, livePort, 'live-owner-token')),
    );
    const malformed = await createFixtureRoot(
      runtimeDirectory,
      'fixture-browser-malformed',
    );
    await writeFile(join(malformed, 'pglite.json'), '{malformed');
    const tokenless = await createFixtureRoot(
      runtimeDirectory,
      'fixture-browser-tokenless',
    );
    await writeFile(
      join(tokenless, 'pglite.json'),
      JSON.stringify(pgliteState(tokenless, 55_530)),
    );
    const mismatching = await createFixtureRoot(
      runtimeDirectory,
      'fixture-browser-mismatching',
    );
    await writeFile(
      join(mismatching, 'pglite.json'),
      JSON.stringify({
        ...pgliteState(mismatching, 55_529, 'mismatching-owner-token'),
        dataPath: join(runtimeDirectory, 'other-pglite'),
      }),
    );

    await sweepStaleFixtureBrowserRoots(runtimeDirectory);

    await expect(readdir(runtimeDirectory)).resolves.toHaveLength(4);
    await expect(
      readFile(join(malformed, 'pglite.json'), 'utf8'),
    ).resolves.toBe('{malformed');
  });
});

describe('fixture-browser PGlite cleanup', () => {
  const ownership = {
    pid: 9_876,
    statePath: '/run/pglite.json',
    dataPath: '/run/pglite',
    port: 55_433,
    ownerToken: 'fixture-owner-token',
  };

  beforeEach(() => {
    canConnectTcp.mockReset();
    readPGliteState.mockReset();
  });

  it('recovers tokenized ownership registered before readiness', async () => {
    let terminated = false;
    const kill = vi.spyOn(process, 'kill').mockImplementation((_, signal) => {
      if (signal === 0) {
        if (!terminated) return true;
        const error = new Error('no such process') as NodeJS.ErrnoException;
        error.code = 'ESRCH';
        throw error;
      }
      terminated = true;
      return true;
    });
    const { pid: _pid, ...preReadinessOwnership } = ownership;
    readPGliteState.mockResolvedValue({
      pid: ownership.pid,
      host: '127.0.0.1',
      port: ownership.port,
      dataPath: ownership.dataPath,
      ownerToken: ownership.ownerToken,
    });
    canConnectTcp.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await expect(stopFixturePGlite(preReadinessOwnership)).resolves.toBe(true);

    expect(kill).toHaveBeenCalledWith(ownership.pid, 'SIGTERM');
    kill.mockRestore();
  });

  it('never signals state that does not exactly match its run ownership', async () => {
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    readPGliteState.mockResolvedValue({
      pid: ownership.pid + 1,
      host: '127.0.0.1',
      port: ownership.port,
      dataPath: ownership.dataPath,
      ownerToken: ownership.ownerToken,
    });

    await expect(stopFixturePGlite(ownership)).resolves.toBe(false);

    expect(kill).not.toHaveBeenCalled();
    kill.mockRestore();
  });

  it('retains every cleanup failure in a single diagnostic', () => {
    const aggregated = aggregateCleanupErrors([
      new Error('owned child cleanup failed'),
      new Error('listener remained busy'),
    ]);

    expect(aggregated).toBeInstanceOf(AggregateError);
    expect((aggregated as Error).message).toContain(
      'owned child cleanup failed',
    );
    expect((aggregated as Error).message).toContain('listener remained busy');
  });
});

describe('fixture-browser pre-readiness failure', () => {
  it('exits a real canary subprocess before the bounded deadline', async () => {
    const runtimeDirectory = join(process.cwd(), '.local/dev-runtime');
    // A fresh checkout has no .local/dev-runtime. Reading it as empty keeps this
    // assertion about what the run leaves behind rather than about whether a
    // previous run happened to create the directory.
    const fixtureRoots = async (): Promise<string[]> =>
      readdir(runtimeDirectory).then(
        (entries) =>
          entries.filter((entry) => entry.startsWith('fixture-browser-')),
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return [];
          throw error;
        },
      );
    const rootsBefore = await fixtureRoots();
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
        env: {
          ...process.env,
          SERVICE_ACCOUNTS_JSON: 'not-json',
        },
        stdio: 'ignore',
      },
    );
    let exceededDeadline = false;
    const deadline = setTimeout(() => {
      exceededDeadline = true;
      child.kill('SIGTERM');
    }, 15_000);
    const outcome = await new Promise<{ code: number | null }>(
      (resolveExit) => {
        child.once('exit', (code) => resolveExit({ code }));
      },
    );
    clearTimeout(deadline);

    expect(exceededDeadline).toBe(false);
    expect(outcome.code).toBe(1);
    expect(Date.now() - startedAt).toBeLessThan(15_000);
    await expect(fixtureRoots()).resolves.toEqual(rootsBefore);
    await expect(busyFixturePorts()).resolves.toEqual(portsBefore);
  }, 20_000);
});
