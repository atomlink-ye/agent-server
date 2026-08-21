import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  commandAvailable,
  defaultHostDatabaseUrl,
  prepareHostNativeEnvironment,
  redactDatabaseUrl,
} from './host-native.js';

export async function setupHostNative(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  if (nodeMajor < 22 || nodeMajor >= 25) {
    throw new Error(`Node 22-24 is required; current runtime is ${process.version}`);
  }
  if (!(await commandAvailable('pnpm'))) {
    throw new Error('pnpm is required; run `corepack enable` first');
  }
  const prepared = await prepareHostNativeEnvironment(environment);
  process.stdout.write(
    [
      'host-native setup ready',
      `node=${process.version}`,
      'pnpm=available',
      `database=${redactDatabaseUrl(defaultHostDatabaseUrl(prepared))}`,
      'migrations=applied',
      'local_directories=ready',
      'next=pnpm dev',
      '',
    ].join('\n'),
  );
  return prepared;
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  setupHostNative().catch((error: unknown) => {
    process.stderr.write(
      `setup failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
