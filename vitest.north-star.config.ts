import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/scenarios/north-star-host-harness.scenario.test.ts',
      'tests/scenarios/north-star-grant.scenario.test.ts',
    ],
    environment: 'node',
    testTimeout: 30_000,
  },
});
