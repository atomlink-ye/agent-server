import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  startTestEnvironment,
  type TestEnvironmentHandle,
} from './test-environment.js';

function isExplicitlyRequested(testModuleUrl: string): boolean {
  const testPath = fileURLToPath(testModuleUrl);
  return process.argv.some((argument) => {
    if (!argument || argument.startsWith('-')) return false;
    try {
      return resolve(process.cwd(), argument) === testPath;
    } catch {
      return false;
    }
  });
}

export async function startDirectRealPostgresIfNeeded(
  testModuleUrl: string,
): Promise<TestEnvironmentHandle | null> {
  if (process.env.DATABASE_URL || process.env.POSTGRES_URL) return null;
  if (process.env.REAL_POSTGRES_REQUIRED === '1') {
    throw new Error(
      'REAL_POSTGRES_REQUIRED=1 requires DATABASE_URL or POSTGRES_URL',
    );
  }
  if (!isExplicitlyRequested(testModuleUrl)) return null;

  const environment = await startTestEnvironment({
    profile: 'postgres',
    keepFailed: process.env.TEST_KEEP_FAILED === '1',
  });
  const databaseUrl = environment.urls.postgres;
  if (!databaseUrl) {
    await environment.stop('failed');
    throw new Error('direct real-Postgres test environment exposed no database URL');
  }
  process.env.DATABASE_URL = databaseUrl;
  process.env.POSTGRES_URL = databaseUrl;
  process.env.POSTGRES_ADMIN_URL = databaseUrl;
  process.env.REAL_POSTGRES_REQUIRED = '1';
  return environment;
}
