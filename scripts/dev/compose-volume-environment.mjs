import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { computeDependencyStamp } from './dependency-stamp.mjs';

const providerFiles = [
  'provider-toolchain/providers.manifest.json',
  'provider-toolchain/pnpm-lock.yaml',
  'provider-toolchain/pnpm-workspace.yaml',
  'provider-toolchain/package.json',
  'provider-toolchain/patches/@getpaseo__server@0.1.110.patch',
  'provider-toolchain/scripts/provider-toolchain.mjs',
];

export async function deriveComposeVolumeEnvironment({
  root,
  architecture,
  nodeAbi = '137',
  includeProvider = false,
}) {
  const arch = ['x86_64', 'x64'].includes(architecture)
    ? 'amd64'
    : ['aarch64', 'arm64'].includes(architecture)
      ? 'arm64'
      : architecture;
  const abi = String(nodeAbi).replaceAll(/[^A-Za-z0-9._-]/gu, '-');
  const dependencyStamp = (await computeDependencyStamp(root)).trim();
  const prefix = `agent-server-cache-v1-node24-abi${abi}-${arch}-${dependencyStamp}`;
  const values = {
    NODE_MODULES_VOLUME: `${prefix}-root`,
    WEB_NODE_MODULES_VOLUME: `${prefix}-web`,
    NODE_MODULES_EXTERNAL: 'true',
    WEB_NODE_MODULES_EXTERNAL: 'true',
  };
  if (!includeProvider) return values;
  const providerHash = createHash('sha256');
  for (const file of providerFiles) {
    providerHash.update(file);
    providerHash.update(await readFile(join(root, file)));
  }
  return {
    ...values,
    PROVIDER_TOOLCHAIN_VOLUME: `agent-server-provider-toolchain-v1-node24-abi${abi}-${arch}-${providerHash.digest('hex')}`,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  const values = await deriveComposeVolumeEnvironment({
    root: resolve(process.argv[2] ?? '.'),
    architecture: process.argv[3] ?? process.arch,
    nodeAbi: process.argv[4] ?? '137',
    includeProvider: process.argv[5] === '--include-provider',
  });
  process.stdout.write(`${JSON.stringify(values)}\n`);
}
