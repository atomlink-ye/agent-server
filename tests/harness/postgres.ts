import { Pool } from 'pg';

import { applyDurableKernelMigrations } from '../../src/infrastructure/postgres/postgres.js';

export type RealPostgresTestDatabase = Readonly<{
  pool: Pool;
  connectionString: string;
  dispose(): Promise<void>;
}>;

export function resolveRealPostgresTestUrl(
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  return (
    environment.TEST_DATABASE_URL?.trim() ||
    environment.INTEGRATION_DATABASE_URL?.trim() ||
    environment.DATABASE_URL?.trim() ||
    null
  );
}

export function assertRealPostgresTestUrl(connectionString: string): void {
  const parsed = new URL(connectionString);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!databaseName || !/test/i.test(databaseName)) {
    throw new Error(
      `refusing destructive test database access: database name must contain "test" (got ${databaseName || '<empty>'})`,
    );
  }
  if (/\b(prod|production|main|live)\b/i.test(databaseName)) {
    throw new Error(
      `refusing destructive test database access: production-flavored database ${databaseName}`,
    );
  }
}

export async function createRealPostgresTestDatabase(
  connectionString = resolveRealPostgresTestUrl(),
): Promise<RealPostgresTestDatabase> {
  if (!connectionString) {
    throw new Error(
      'real Postgres test database is not configured; set TEST_DATABASE_URL',
    );
  }
  assertRealPostgresTestUrl(connectionString);
  const pool = new Pool({ connectionString, max: 4 });
  try {
    await applyDurableKernelMigrations(pool);
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
  return {
    pool,
    connectionString,
    async dispose() {
      await pool.end();
    },
  };
}
