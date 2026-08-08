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
  let outputPath: string;

  switch (target) {
    case 'chat-surface':
      outputPath = resolve(
        repoRoot,
        'apps/web/__inventory__/chat-surface.json',
      );
      break;
    case 'canary':
      outputPath = resolve(tmpdir(), 'vitest-browser-canary-inventory.json');
      break;
    default:
      throw new Error(`Unsupported inventory target: ${String(target)}`);
  }

  const content = `${JSON.stringify(inventory, null, 2)}\n`;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content, 'utf8');
  return { path: outputPath, bytes: Buffer.byteLength(content) };
};

export default defineConfig({
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
    exclude: [...configDefaults.exclude],
    projects: [
      {
        extends: true,
        test: {
          name: 'web-node',
          include: ['apps/web/**/*.test.{ts,tsx}'],
          exclude: [
            ...configDefaults.exclude,
            'apps/web/**/*.browser.test.{ts,tsx}',
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
          include: ['**/*.browser.test.{ts,tsx}'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
            commands: {
              writeInventory,
            },
          },
        },
      },
    ],
  },
});
