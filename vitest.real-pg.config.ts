import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/integration/real-pg-pool.integration.test.ts',
      'tests/integration/postgres-migration-concurrency.integration.test.ts',
      'tests/integration/agent-registry-postgres.integration.test.ts',
      'tests/integration/session-lane-postgres.integration.test.ts',
      'tests/integration/runtime-memory-real-pg.integration.test.ts',
      'tests/integration/run-cancellation-postgres.integration.test.ts',
    ],
    globalSetup: ['./tests/support/environment/real-postgres-global-setup.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
