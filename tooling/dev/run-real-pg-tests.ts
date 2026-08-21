import { runCommand, redactDatabaseUrl } from './host-native.js';

function resolveTestDatabaseUrl(
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  return (
    environment.TEST_DATABASE_URL?.trim() ||
    environment.INTEGRATION_DATABASE_URL?.trim() ||
    null
  );
}

function assertDedicatedTestDatabase(connectionString: string): void {
  const parsed = new URL(connectionString);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!databaseName) throw new Error('test database URL must include a database name');
  if (/\b(prod|production|main|live)\b/i.test(databaseName)) {
    throw new Error(
      `refusing real Postgres tests against production-flavored database: ${databaseName}`,
    );
  }
  if (!/test/i.test(databaseName)) {
    throw new Error(
      `refusing real Postgres tests because database name does not contain "test": ${databaseName}`,
    );
  }
}

export async function runRealPostgresTests(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const connectionString = resolveTestDatabaseUrl(environment);
  if (!connectionString) {
    process.stdout.write(
      [
        '[test:pg] skipped — set TEST_DATABASE_URL (or INTEGRATION_DATABASE_URL) to a dedicated local test database.',
        `          example: TEST_DATABASE_URL=postgresql://${process.env.USER ?? 'postgres'}@127.0.0.1:5432/agent_server_test pnpm test:pg`,
        '',
      ].join('\n'),
    );
    return;
  }
  assertDedicatedTestDatabase(connectionString);
  process.stdout.write(
    `[test:pg] using ${redactDatabaseUrl(connectionString)}\n`,
  );
  await runCommand(
    'pnpm',
    ['exec', 'vitest', 'run', '--config', 'vitest.real-pg.config.ts'],
    {
      environment: {
        ...environment,
        DATABASE_URL: connectionString,
        POSTGRES_URL: connectionString,
        POSTGRES_ADMIN_URL: connectionString,
        REAL_POSTGRES_REQUIRED: '1',
      },
    },
  );
}

runRealPostgresTests().catch((error: unknown) => {
  process.stderr.write(
    `[test:pg] failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
