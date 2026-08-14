import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const protectedNames = [
  'postgres-work-identity-repository',
  'postgres-work-projection-facts-query',
];

describe('Work module concrete import boundary', () => {
  it('keeps concrete Work PostgreSQL helpers behind the Work module', () => {
    const files = execFileSync('git', ['ls-files', 'src/**/*.ts'], {
      cwd: root,
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter(Boolean)
      .filter((path) => !path.includes('.test.'));
    const violations: string[] = [];
    for (const path of files) {
      if (path.startsWith('src/modules/work/')) continue;
      if (protectedNames.some((name) => path.includes(name))) continue;
      const source = readFileSync(resolve(root, path), 'utf8');
      if (protectedNames.some((name) => source.includes(name))) violations.push(path);
    }
    expect(violations).toEqual([]);
  });
});
