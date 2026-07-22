import { lstat, readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const planRoot = join(repositoryRoot, 'docs', 'exec-plans');
const lanes = ['active', 'completed'];
const errors = [];
let count = 0;

for (const lane of lanes) {
  const directory = join(planRoot, lane);
  if (!(await exists(directory))) {
    errors.push(`missing Exec Plan lane: docs/exec-plans/${lane}`);
    continue;
  }
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      continue;
    }
    count += 1;
    const path = join(directory, entry.name);
    const source = await readFile(path, 'utf8');
    const display = relative(repositoryRoot, path);
    const status = source.match(/^status:\s*(active|completed)\s*$/m)?.[1];
    if (status !== lane) {
      errors.push(
        `${display}: status must be ${lane}, found ${status ?? 'none'}`,
      );
    }
    if (lane === 'completed' && /^\s*- \[ \]/m.test(source)) {
      errors.push(`${display}: completed plans cannot contain unchecked items`);
    }
  }
}

if (errors.length > 0) {
  process.stderr.write(`Exec Plan checks failed:\n- ${errors.join('\n- ')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Exec Plan checks passed (${count} plans).\n`);
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}
