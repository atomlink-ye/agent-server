import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 90000,
    hookTimeout: 120000,
    globalSetup: ['./tests/e2e/setup.ts'],
  },
})
