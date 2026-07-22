import { rm } from 'node:fs/promises';

await Promise.all(
  ['dist', 'coverage', '.vitest', '.local'].map((path) =>
    rm(path, { force: true, recursive: true }),
  ),
);

process.stdout.write('Removed generated build and test output.\n');
