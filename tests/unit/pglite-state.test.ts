import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readPGliteState } from '../../tooling/dev/host-native.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('PGlite state publication', () => {
  it('tolerates a partial state file while the writer finishes publishing it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-server-pglite-'));
    temporaryDirectories.push(directory);
    const statePath = join(directory, 'pglite.json');
    const state = {
      kind: 'agent-server-pglite' as const,
      pid: process.pid,
      host: '127.0.0.1',
      port: 55_432,
      database: 'postgres',
      url: 'postgresql://postgres:postgres@127.0.0.1:55432/postgres',
      dataPath: join(directory, 'pglite'),
    };

    await writeFile(statePath, '{"kind":"agent-server-pglite"', 'utf8');
    const readState = readPGliteState(statePath);
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 40));
    await writeFile(statePath, `${JSON.stringify(state)}\n`, 'utf8');

    await expect(readState).resolves.toEqual(state);
    await expect(readFile(statePath, 'utf8')).resolves.toContain(
      '"port":55432',
    );
  });
});
