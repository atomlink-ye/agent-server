import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('Apache NOTICE attribution', () => {
  it('keeps the Cloudflare OS attribution and source revision', () => {
    const notice = readFileSync(resolve(root, 'NOTICE'), 'utf8');
    expect(notice).toContain('Cloudflare OS');
    expect(notice).toContain('0eaec6c5e8fc6b3298ea1aa73bf5c3e47b923c7f');
  });
});
