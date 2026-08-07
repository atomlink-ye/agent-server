import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/contract/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    maxWorkers: 2,
  },
});
