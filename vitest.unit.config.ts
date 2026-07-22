import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'scripts/dev/**/*.test.mjs'],
    environment: 'node',
    testTimeout: 5_000,
  },
});
