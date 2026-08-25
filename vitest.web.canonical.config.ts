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
        find: /^@\//,
        replacement: `${resolve(repoRoot, 'apps/web/src')}/`,
      },
    ],
  },
  test: {
    testTimeout: 30_000,
    include: [
      'src/features/conversations/ConversationsPage.browser.test.tsx',
      'src/features/work/components/work-list.browser.test.tsx',
      'src/features/work/components/work-detail.browser.test.tsx',
      'src/features/work/components/definition-authoring.browser.test.tsx',
      'src/features/run-trace/run-trace.browser.test.tsx',
      'src/features/run-trace/events.browser.test.tsx',
      'src/features/run-trace/map.browser.test.tsx',
      'src/features/run-trace/session-transcripts.browser.test.tsx',
    ],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
});
