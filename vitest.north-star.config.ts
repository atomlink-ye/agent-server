import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/scenarios/north-star-chat-work.scenario.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
