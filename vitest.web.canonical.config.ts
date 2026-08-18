import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { playwright } from '@vitest/browser-playwright';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const repoRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: resolve(repoRoot, 'apps/web'),
  resolve: {
    alias: [
      {
        find: /^server-only$/,
        replacement: resolve(repoRoot, 'apps/web/lib/server-only-noop.ts'),
      },
      {
        find: /^@\//,
        replacement: `${resolve(repoRoot, 'apps/web')}/`,
      },
    ],
  },
  test: {
    testTimeout: 30_000,
    include: [
      'components/work/work-list.browser.test.tsx',
      'components/work/work-detail.browser.test.tsx',
      'components/work/definition-authoring.browser.test.tsx',
      'features/run-trace/run-trace.browser.test.tsx',
      'features/run-trace/events.browser.test.tsx',
      'features/run-trace/map.browser.test.tsx',
      'features/run-trace/execution-transcript.browser.test.tsx',
      'features/run-trace/session-transcripts.browser.test.tsx',
    ],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
});
