import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const markdownFiles = execFileSync('git', ['ls-files'], {
  cwd: root,
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .filter((path) => path.endsWith('.md'));

const markdownLink = /\[[^\]]*\]\(([^)]+)\)/g;

function localMarkdownTarget(rawTarget: string): string | null {
  const target = rawTarget.trim();
  if (
    !target ||
    target.startsWith('#') ||
    target.startsWith('http://') ||
    target.startsWith('https://') ||
    target.startsWith('mailto:') ||
    target.startsWith('/')
  ) {
    return null;
  }
  const withoutTitle = target.split(/\s+["']/u, 1)[0] ?? target;
  const path = withoutTitle.split('#', 1)[0]?.split('?', 1)[0] ?? '';
  return path.endsWith('.md') ? decodeURIComponent(path) : null;
}

describe('durable documentation links', () => {
  it('does not link tracked Markdown to deleted task/evidence documents', () => {
    const broken: string[] = [];
    for (const file of markdownFiles) {
      const source = readFileSync(resolve(root, file), 'utf8');
      for (const match of source.matchAll(markdownLink)) {
        const target = localMarkdownTarget(match[1] ?? '');
        if (!target) continue;
        const resolved = resolve(dirname(resolve(root, file)), target);
        if (!existsSync(resolved)) broken.push(`${file} -> ${target}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
