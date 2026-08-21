import {
  defaultHostDatabaseUrl,
  prepareHostNativeEnvironment,
  redactDatabaseUrl,
} from './host-native.js';

export async function setupHostNative(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  const prepared = await prepareHostNativeEnvironment(environment);
  process.stdout.write(
    [
      'host-native setup ready',
      `database=${redactDatabaseUrl(defaultHostDatabaseUrl(prepared))}`,
      'migrations=applied',
      'local_directories=ready',
      'next=pnpm dev',
      '',
    ].join('\n'),
  );
  return prepared;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  setupHostNative().catch((error: unknown) => {
    process.stderr.write(
      `setup failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
