import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compatibilitySurfaceRecords } from './compatibility-surface-records.js';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const src = resolve(root, 'src');

function walk(dir: string): string[] {
  const result: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = resolve(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) result.push(...walk(path));
    else if (/\.(?:ts|tsx)$/.test(name) && !/\.test\./.test(name))
      result.push(path);
  }
  return result;
}

const violations: string[] = [];
const recordSymbols = new Set(
  compatibilitySurfaceRecords
    .filter((record) => record.productionConsumers.length > 0)
    .map((record) => record.symbol),
);

function requireRecord(path: string, symbol: string, category: string): void {
  if (!recordSymbols.has(symbol))
    violations.push(`${path}: ${category} ${symbol}`);
}

for (const file of walk(src)) {
  const path = relative(root, file).replaceAll('\\', '/');
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(
    /@deprecated\b[^\n]*(?:\n\s*\*[^\n]*)*\n\s*export\s+(?:type|interface|class|function|const)\s+([A-Za-z0-9_]+)/g,
  )) {
    requireRecord(path, match[1]!, '@deprecated production surface');
  }
  for (const match of text.matchAll(
    /\b(?:type|interface|class|function|const)\s+(Legacy[A-Za-z0-9_]*)/g,
  )) {
    requireRecord(path, match[1]!, 'legacy production symbol');
  }
}

if (violations.length) {
  process.stderr.write(`${violations.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('compatibility-surfaces: ok\n');
}
