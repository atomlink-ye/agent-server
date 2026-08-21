import { runCommand } from './host-native.js';

type TestPgStatus =
  | { lane: 'test:pg'; status: 'skipped'; reason: 'missing_database_url' }
  | { lane: 'test:pg'; status: 'running' };

function writeTestPgStatus(status: TestPgStatus): void {
  process.stdout.write(`${JSON.stringify(status)}\n`);
}

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
    writeTestPgStatus({
      lane: 'test:pg',
      status: 'skipped',
      reason: 'missing_database_url',
    });
    return;
  }
  assertDedicatedTestDatabase(connectionString);
  writeTestPgStatus({ lane: 'test:pg', status: 'running' });
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
