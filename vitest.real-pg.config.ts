import { defineConfig } from 'vitest/config';

import { realPostgresSuites } from './tests/support/environment/real-postgres-suites.js';

export default defineConfig({
  test: {
    include: [...realPostgresSuites],
    globalSetup: ['./tests/support/environment/real-postgres-global-setup.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
