import { execFileSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const args = process.argv.slice(2);
const baseIndex = args.indexOf('--base');
if (baseIndex < 0 || !args[baseIndex + 1]) {
  throw new Error('Usage: pnpm scope:changed --base <verified-base-ref>');
}
const base = args[baseIndex + 1]!;

function git(argv: readonly string[]): string {
  return execFileSync('git', [...argv], { cwd: root, encoding: 'utf8' }).trim();
}

const mergeBase = git(['merge-base', base, 'HEAD']);
const lines = (value: string): string[] =>
  value ? value.split('\n').map((item) => item.trim()).filter(Boolean) : [];
const committed = lines(git(['diff', '--name-only', `${mergeBase}..HEAD`]));
const staged = lines(git(['diff', '--cached', '--name-only']));
const unstaged = lines(git(['diff', '--name-only']));
const untracked = lines(git(['ls-files', '--others', '--exclude-standard']));
const all = [...new Set([...committed, ...staged, ...unstaged, ...untracked])];

const areaFor = (path: string): string => {
  if (path.startsWith('apps/web/')) return 'web';
  if (path.startsWith('docs/') || path === 'AGENTS.md' || path.startsWith('.agents/')) return 'docs';
  if (path.includes('/runtime') || path.includes('/paseo') || path.includes('/extensions/')) return 'runtime';
  if (path.includes('/postgres/') || path.includes('/migrations/')) return 'persistence';
  if (path.includes('/team') || path.includes('/collaboration')) return 'team';
  if (path.includes('/work')) return 'work';
  if (path.startsWith('tests/')) return 'tests';
  if (path.startsWith('scripts/') || path.startsWith('tooling/')) return 'harness';
  return 'core';
};

process.stdout.write(`${JSON.stringify({
  repository: relative(process.cwd(), root) || '.',
  base,
  mergeBase,
  head: git(['rev-parse', 'HEAD']),
  committed,
  staged,
  unstaged,
  untracked,
  areas: [...new Set(all.map(areaFor))].sort(),
}, null, 2)}\n`);
