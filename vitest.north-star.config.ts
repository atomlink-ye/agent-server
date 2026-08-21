import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/scenarios/north-star-host-harness.scenario.test.ts',
      'tests/scenarios/north-star-grant.scenario.test.ts',
      // Retain the pre-refactor deep regression coverage while the canonical
      // product composition lives in tests/harness/. This keeps every existing
      // assertion active without making its 1,900-line fixture composition the
      // pattern for new scenarios.
      'tests/scenarios/north-star-chat-work.scenario.test.ts',
    ],
    environment: 'node',
    testTimeout: 30_000,
  },
});
