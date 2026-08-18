import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  durableKernelMigrationFileNames,
  resolveDurableKernelRepoRoot,
} from '../../src/infrastructure/postgres/postgres.js';

describe('durable PostgreSQL migration registry', () => {
  it('registers every SQL migration in the directory exactly once', async () => {
    const migrationDirectory = resolve(
      resolveDurableKernelRepoRoot(),
      'src/infrastructure/postgres/migrations',
    );
    const directoryFiles = (await readdir(migrationDirectory))
      .filter((fileName) => fileName.endsWith('.sql'))
      .sort();
    const registered = [...durableKernelMigrationFileNames].sort();

    expect(registered).toEqual(directoryFiles);
    expect(new Set(registered).size).toBe(registered.length);
  });
});
