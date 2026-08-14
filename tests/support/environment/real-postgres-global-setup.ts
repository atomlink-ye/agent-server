import { startTestEnvironment } from './test-environment.js';

export default async function setup(): Promise<() => Promise<void>> {
  if (process.env.DATABASE_URL || process.env.POSTGRES_URL) {
    process.env.REAL_POSTGRES_REQUIRED = '1';
    return async () => undefined;
  }
  const keepFailed = process.env.TEST_KEEP_FAILED === '1';
  const environment = await startTestEnvironment({
    profile: 'postgres',
    keepFailed,
  });
  const databaseUrl = environment.urls.postgres;
  if (!databaseUrl) {
    await environment.stop('failed');
    throw new Error('postgres test environment did not expose a database URL');
  }
  process.env.DATABASE_URL = databaseUrl;
  process.env.POSTGRES_URL = databaseUrl;
  process.env.POSTGRES_ADMIN_URL = databaseUrl;
  process.env.REAL_POSTGRES_REQUIRED = '1';
  return async () => {
    await environment.stop(keepFailed ? 'failed' : 'passed');
  };
}
