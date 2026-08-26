import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  identifyDatabaseBackend,
  repositoryRoot,
  resolvePGlitePaths,
} from './host-native.js';

describe('host-native PGlite ownership paths', () => {
  it('keeps the default state and data paths stable', () => {
    expect(resolvePGlitePaths({})).toEqual({
      statePath: resolve(repositoryRoot, '.local/dev-runtime/pglite.json'),
      dataPath: resolve(repositoryRoot, '.local/dev-runtime/pglite'),
    });
  });

  it('recognizes a live PGlite state at configured paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-server-pglite-test-'));
    const environment = {
      PGLITE_STATE_PATH: join(root, 'state', 'pglite.json'),
      PGLITE_DATA_PATH: join(root, 'data'),
    };
    const paths = resolvePGlitePaths(environment);
    try {
      await mkdir(join(root, 'state'), { recursive: true });
      await writeFile(
        paths.statePath,
        `${JSON.stringify({
          kind: 'agent-server-pglite',
          pid: process.pid,
          host: '127.0.0.1',
          port: 55432,
          database: 'postgres',
          url: 'postgresql://postgres:postgres@127.0.0.1:55432/postgres',
          dataPath: paths.dataPath,
        })}\n`,
        { encoding: 'utf8', flag: 'w' },
      );
      expect(
        await identifyDatabaseBackend(
          'postgresql://postgres:postgres@127.0.0.1:55432/postgres',
          environment,
        ),
      ).toBe('pglite');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('clears malformed configured state and treats stale state as Postgres', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-server-pglite-test-'));
    const statePath = join(root, 'pglite.json');
    const environment = { PGLITE_STATE_PATH: statePath };
    try {
      await writeFile(statePath, '{malformed');
      await expect(
        identifyDatabaseBackend('postgresql://unused', environment),
      ).rejects.toThrow('Ignoring malformed PGlite state');
      await expect(readFile(statePath)).rejects.toMatchObject({
        code: 'ENOENT',
      });

      await writeFile(
        statePath,
        JSON.stringify({
          kind: 'agent-server-pglite',
          pid: 99_999_999,
          host: '127.0.0.1',
          port: 55432,
          database: 'postgres',
          url: 'postgresql://unused',
          dataPath: join(root, 'data'),
        }),
      );
      expect(
        await identifyDatabaseBackend('postgresql://unused', environment),
      ).toBe('postgres');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
