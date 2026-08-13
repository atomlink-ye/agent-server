import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const files = [
  'provider-toolchain/providers.manifest.json',
  'provider-toolchain/pnpm-lock.yaml',
  'provider-toolchain/pnpm-workspace.yaml',
  'provider-toolchain/package.json',
  'provider-toolchain/patches/@getpaseo__server@0.1.110.patch',
  'provider-toolchain/scripts/provider-toolchain.mjs',
];
const hash = createHash('sha256');
for (const file of files) {
  hash.update(file);
  hash.update(await readFile(join(root, file)));
}
process.stdout.write(`${hash.digest('hex')}\n`);
