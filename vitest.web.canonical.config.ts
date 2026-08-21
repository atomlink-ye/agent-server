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
      'src/desktop/ChatShell.browser.test.tsx',
      'src/components/work/work-list.browser.test.tsx',
      'src/components/work/work-detail.browser.test.tsx',
      'src/components/work/definition-authoring.browser.test.tsx',
      'src/features/run-trace/run-trace.browser.test.tsx',
      'src/features/run-trace/events.browser.test.tsx',
      'src/features/run-trace/map.browser.test.tsx',
      'src/features/run-trace/execution-transcript.browser.test.tsx',
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
