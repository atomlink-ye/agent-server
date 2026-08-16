import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/**/*.test.ts',
      'tests/unit/**/*.test.ts',
      'scripts/dev/**/*.test.mjs',
      'scripts/smoke/**/*.test.mjs',
    ],
    environment: 'node',
    testTimeout: 30_000,
  },
});
