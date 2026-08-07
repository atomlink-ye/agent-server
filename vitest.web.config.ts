import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const repoRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^server-only$/,
        replacement: resolve(repoRoot, 'apps/web/lib/server-only-noop.ts'),
      },
    ],
  },
  test: {
    include: ['apps/web/**/*.test.ts', 'apps/web/**/*.test.tsx'],
    environment: 'node',
    testTimeout: 5_000,
  },
});
