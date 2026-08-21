export default async function setup(): Promise<() => Promise<void>> {
  const databaseUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!databaseUrl) {
    throw new Error(
      'Real PostgreSQL tests require DATABASE_URL or POSTGRES_URL. See README.md#real-postgresql-test-files for native PostgreSQL setup.',
    );
  }
  process.env.DATABASE_URL = databaseUrl;
  process.env.POSTGRES_URL = databaseUrl;
  process.env.POSTGRES_ADMIN_URL = databaseUrl;
  process.env.REAL_POSTGRES_REQUIRED = '1';
  return async () => undefined;
}
