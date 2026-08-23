import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/scenarios/north-star-runtime.scenario.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
