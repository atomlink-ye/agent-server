import { defineConfig } from 'vitest/config';

import { realPostgresSuites } from './tests/support/environment/real-postgres-suites.js';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    exclude: [...realPostgresSuites],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
