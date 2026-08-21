export default async function setup(): Promise<() => Promise<void>> {
  const databaseUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!databaseUrl) {
    throw new Error(
      'Real Postgres tests require DATABASE_URL/POSTGRES_URL. Use `pnpm test:pg`, which safely skips when TEST_DATABASE_URL is not configured.',
    );
  }
  process.env.DATABASE_URL = databaseUrl;
  process.env.POSTGRES_URL = databaseUrl;
  process.env.POSTGRES_ADMIN_URL = databaseUrl;
  process.env.REAL_POSTGRES_REQUIRED = '1';
  return async () => undefined;
}
