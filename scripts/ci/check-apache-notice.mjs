import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRoot = resolve(scriptDirectory, '..', '..');
const requiredCommit = '0eaec6c5e8fc6b3298ea1aa73bf5c3e47b923c7f';

function parseRoot(argv) {
  const index = argv.indexOf('--root');
  if (index === -1) return defaultRoot;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error('--root requires a path');
  }
  return resolve(value);
}

async function checkNotice(root) {
  const noticePath = resolve(root, 'NOTICE');
  try {
    await access(noticePath, constants.R_OK);
  } catch {
    console.error('missing required notice: NOTICE');
    return false;
  }

  const notice = await readFile(noticePath, 'utf8');
  const missing = [];
  if (!notice.includes('Cloudflare OS')) missing.push('Cloudflare OS');
  if (!notice.includes(requiredCommit))
    missing.push(`upstream commit ${requiredCommit}`);

  if (missing.length > 0) {
    console.error(
      `NOTICE is missing required provenance: ${missing.join('; ')}`,
    );
    return false;
  }

  console.log(`Apache NOTICE check passed: Cloudflare OS (${requiredCommit})`);
  return true;
}

try {
  const ok = await checkNotice(parseRoot(process.argv.slice(2)));
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
