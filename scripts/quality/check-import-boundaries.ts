import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const src = resolve(root, 'src');

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = resolve(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...files(path));
    else if (/\.(?:ts|tsx)$/.test(name) && !name.endsWith('.test.ts') && !name.endsWith('.test.tsx')) out.push(path);
  }
  return out;
}

const importPattern = /(?:from\s+|import\s*\()\s*['"]([^'"]+)['"]/g;
const violations: string[] = [];

for (const file of files(src)) {
  const rel = relative(root, file).replaceAll('\\', '/');
  const text = readFileSync(file, 'utf8');
  const imports = [...text.matchAll(importPattern)].map((match) => match[1]!);
  for (const specifier of imports) {
    if (rel.startsWith('src/domain/')) {
      if (
        /^(?:hono|pg|@getpaseo\/)/.test(specifier) ||
        /(?:^|\/)application\//.test(specifier) ||
        /(?:^|\/)adapters\//.test(specifier) ||
        /(?:^|\/)infrastructure\//.test(specifier) ||
        /(?:^|\/)composition\//.test(specifier) ||
        /(?:^|\/)entrypoints\//.test(specifier)
      ) {
        violations.push(`${rel}: domain imports forbidden dependency ${specifier}`);
      }
    }
    if (rel.startsWith('src/application/')) {
      if (
        /^(?:hono|pg|@getpaseo\/)/.test(specifier) ||
        /(?:^|\/)infrastructure\/postgres\//.test(specifier) ||
        /(?:^|\/)adapters\/paseo\//.test(specifier) ||
        /(?:^|\/)entrypoints\//.test(specifier) ||
        /(?:^|\/)composition\//.test(specifier)
      ) {
        violations.push(`${rel}: application imports concrete boundary ${specifier}`);
      }
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(`${violations.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('import-boundaries: ok\n');
}
