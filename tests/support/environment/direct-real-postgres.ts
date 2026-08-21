import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface DirectRealPostgresHandle {
  stop(outcome?: 'passed' | 'failed'): Promise<void>;
}

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
): Promise<DirectRealPostgresHandle | null> {
  if (process.env.DATABASE_URL || process.env.POSTGRES_URL) return null;
  if (!isExplicitlyRequested(testModuleUrl)) return null;
  throw new Error(
    'A directly-run real PostgreSQL test requires DATABASE_URL or POSTGRES_URL. See README.md#real-postgresql-test-files for native PostgreSQL setup.',
  );
}
