import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { playwright } from '@vitest/browser-playwright';
import react from '@vitejs/plugin-react';
import type { BrowserCommand } from 'vitest/node';
import { configDefaults, defineConfig } from 'vitest/config';

const repoRoot = dirname(fileURLToPath(import.meta.url));

type InventoryTarget = 'chat-surface' | 'canary';

const writeInventory: BrowserCommand<
  [json: string, target?: InventoryTarget]
> = async (_context, json, target = 'chat-surface') => {
  const inventory = JSON.parse(json) as unknown;
  const outputPath =
    target === 'canary'
      ? resolve(tmpdir(), 'vitest-browser-canary-inventory.json')
      : resolve(repoRoot, 'apps/web/__inventory__/chat-surface.json');
  const content = `${JSON.stringify(inventory, null, 2)}\n`;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content, 'utf8');
  return { path: outputPath, bytes: Buffer.byteLength(content) };
};

export default defineConfig({
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
    exclude: [...configDefaults.exclude],
    projects: [
      {
        extends: true,
        test: {
          name: 'web-node',
          include: ['apps/web/src/**/*.test.{ts,tsx}'],
          exclude: [
            ...configDefaults.exclude,
            'apps/web/src/**/*.browser.test.{ts,tsx}',
          ],
          environment: 'node',
        },
      },
      {
        extends: true,
        plugins: [react()],
        root: resolve(repoRoot, 'apps/web'),
        test: {
          name: 'web-dom',
          include: ['src/**/*.browser.test.{ts,tsx}'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
            commands: { writeInventory },
          },
        },
      },
    ],
  },
});
