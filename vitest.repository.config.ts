import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/repository/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
