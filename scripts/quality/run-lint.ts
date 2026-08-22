import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function run(script: string): number {
  process.stdout.write(`> pnpm ${script}\n`);
  return (
    spawnSync('pnpm', [script], { cwd: root, stdio: 'inherit' }).status ?? 1
  );
}

const format = run('format:check');
const typecheck = run('typecheck');
process.exitCode = format || typecheck ? 1 : 0;
