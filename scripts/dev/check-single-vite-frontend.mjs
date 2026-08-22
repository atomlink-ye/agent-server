import { access, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const failures = [];

async function exists(path) {
  try {
    await access(resolve(root, path));
    return true;
  } catch {
    return false;
  }
}

async function walk(path) {
  const absolute = resolve(root, path);
  const entries = await readdir(absolute, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const relative = `${path}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await walk(relative)));
    else files.push(relative);
  }
  return files;
}

if (await exists('apps/web-vite'))
  failures.push('apps/web-vite must not exist');
for (const path of [
  'apps/web/next.config.ts',
  'apps/web/next.config.js',
  'apps/web/next-env.d.ts',
  'compose.web-vite.yaml',
  'vitest.web-vite.config.ts',
]) {
  if (await exists(path)) failures.push(`${path} must not exist`);
}

const webPackage = JSON.parse(
  await readFile(resolve(root, 'apps/web/package.json'), 'utf8'),
);
if (!String(webPackage.scripts?.dev ?? '').includes('vite')) {
  failures.push('apps/web dev script must use Vite');
}
for (const section of ['dependencies', 'devDependencies']) {
  for (const forbidden of ['next', 'server-only']) {
    if (webPackage[section]?.[forbidden]) {
      failures.push(`apps/web ${section} must not contain ${forbidden}`);
    }
  }
}

for (const path of await walk('apps/web')) {
  if (!/\.(?:[cm]?[jt]sx?|json)$/u.test(path)) continue;
  const content = await readFile(resolve(root, path), 'utf8').catch(() => '');
  if (
    /from\s+['"]next(?:\/|['"])/u.test(content) ||
    /require\(['"]next(?:\/|['"])/u.test(content)
  ) {
    failures.push(`${path} imports Next.js`);
  }
  if (/['"]server-only['"]/u.test(content))
    failures.push(`${path} imports server-only`);
}

const lockfile = await readFile(resolve(root, 'pnpm-lock.yaml'), 'utf8');
if (/^\s{2}apps\/web-vite:/mu.test(lockfile)) {
  failures.push('pnpm-lock.yaml still contains apps/web-vite importer');
}
if (
  /^\s{6}next:\s*$/mu.test(lockfile) ||
  /^\s{6}server-only:\s*$/mu.test(lockfile)
) {
  failures.push(
    'pnpm-lock.yaml still declares Next/server-only for a workspace importer',
  );
}

if (failures.length > 0) {
  process.stderr.write(
    `single Vite frontend guard failed:\n- ${failures.join('\n- ')}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write('single Vite frontend guard passed\n');
}
