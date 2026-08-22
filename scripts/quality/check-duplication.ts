import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const rawPackage = readFileSync(resolve(root, 'package.json'), 'utf8');

function duplicateObjectKeys(raw: string, objectName: string): string[] {
  const marker = `\"${objectName}\"`;
  const start = raw.indexOf(marker);
  if (start < 0) return [];
  const open = raw.indexOf('{', start);
  if (open < 0) return [];
  let depth = 0;
  let end = -1;
  for (let index = open; index < raw.length; index += 1) {
    if (raw[index] === '{') depth += 1;
    if (raw[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  if (end < 0) return [];
  const body = raw.slice(open + 1, end);
  const keys = [...body.matchAll(/^\s*\"([^\"]+)\"\s*:/gm)].map(
    (match) => match[1]!,
  );
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return [...counts].filter(([, count]) => count > 1).map(([key]) => key);
}

const duplicates = duplicateObjectKeys(rawPackage, 'scripts');
if (duplicates.length > 0) {
  process.stderr.write(`duplicate package scripts: ${duplicates.join(', ')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('duplication: no duplicate package command keys\n');
}
