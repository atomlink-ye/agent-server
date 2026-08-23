import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/integration/session-message-provenance.integration.test.ts',
    ],
    environment: 'node',
    testTimeout: 30_000,
  },
});
