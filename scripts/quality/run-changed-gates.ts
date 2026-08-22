import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const args = process.argv.slice(2);
const baseIndex = args.indexOf('--base');
if (baseIndex < 0 || !args[baseIndex + 1])
  throw new Error('Usage: pnpm gates:changed --base <verified-base-ref>');
const base = args[baseIndex + 1]!;

function git(argv: readonly string[]): string {
  return execFileSync('git', [...argv], { cwd: root, encoding: 'utf8' }).trim();
}
function run(command: string, commandArgs: readonly string[]): void {
  process.stdout.write(`> ${command} ${commandArgs.join(' ')}\n`);
  execFileSync(command, [...commandArgs], { cwd: root, stdio: 'inherit' });
}

const mergeBase = git(['merge-base', base, 'HEAD']);
const changed = git(['diff', '--name-only', `${mergeBase}..HEAD`])
  .split('\n')
  .map((value) => value.trim())
  .filter(Boolean);
const has = (predicate: (path: string) => boolean): boolean =>
  changed.some(predicate);

run('pnpm', ['check:imports']);
run('pnpm', ['check:compatibility-surfaces']);
run('pnpm', ['check:package-commands']);

if (has((path) => path === 'AGENTS.md' || path.startsWith('docs/'))) {
  run('pnpm', ['docs:check']);
}
if (has((path) => path.startsWith('apps/web/'))) {
  run('pnpm', ['web:check:types']);
  run('pnpm', ['web:check:architecture']);
  run('pnpm', ['web:build']);
}
if (
  has(
    (path) =>
      path.startsWith('src/') ||
      path.startsWith('tests/') ||
      path.startsWith('tooling/') ||
      path.startsWith('scripts/'),
  )
) {
  run('pnpm', ['typecheck']);
}
