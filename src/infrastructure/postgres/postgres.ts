import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool, type PoolConfig, type PoolClient } from 'pg';

export interface PostgresBootstrapOptions {
  readonly connectionString?: string;
  readonly maxConnections?: number;
  readonly idleTimeoutMs?: number;
}

export interface PostgresMigrationExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{
    readonly rows?: readonly Row[];
    readonly rowCount?: number | null;
  }>;
  exec?(sql: string): Promise<unknown>;
}

const durableKernelMigrationFileNames = [
  '0001_durable_kernel_a.sql',
  '0002_phase_2a_authenticated_admission.sql',
  '0003_sequential_team_mvp.sql',
  '0004_workspace_memory_proposal_mvp.sql',
  '0005_managed_agent_registry_b.sql',
  '0005b_managed_agent_registry_hardening.sql',
  '0006_workspace_session_lane_c.sql',
  '0007_runtime_events_d.sql',
  '0008_managed_memory_e.sql',
] as const;
const durableKernelMigrationRegistryTable = 'durable_kernel_schema_migrations';

export function resolveDurableKernelRepoRoot(
  moduleUrl: string = import.meta.url,
): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), '../../..');
}

export function resolveDurableKernelMigrationFilePath(
  fileName: (typeof durableKernelMigrationFileNames)[number],
  moduleUrl: string = import.meta.url,
): string {
  return resolve(
    resolveDurableKernelRepoRoot(moduleUrl),
    'src/infrastructure/postgres/migrations',
    fileName,
  );
}

export const durableKernelMigrationFilePaths = [
  ...durableKernelMigrationFileNames.map((fileName) =>
    resolveDurableKernelMigrationFilePath(fileName),
  ),
] as const;

export function resolvePostgresConnectionString(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const connectionString = environment.DATABASE_URL ?? environment.POSTGRES_URL;

  if (!connectionString) {
    throw new Error(
      'Postgres connection string must be provided via DATABASE_URL or POSTGRES_URL',
    );
  }

  return connectionString;
}

export function createPostgresPool(
  options: PostgresBootstrapOptions = {},
): Pool {
  const config: PoolConfig = {
    connectionString:
      options.connectionString ?? resolvePostgresConnectionString(),
    max: options.maxConnections ?? 10,
    idleTimeoutMillis: options.idleTimeoutMs ?? 30_000,
  };

  return new Pool(config);
}

export async function withPostgresConnection<T>(
  pool: Pick<Pool, 'connect'>,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    return await work(client);
  } finally {
    client.release();
  }
}

export async function readDurableKernelMigration(
  filePath: string = durableKernelMigrationFilePaths[0]!,
): Promise<string> {
  return readFile(filePath, 'utf8');
}

export async function applyDurableKernelMigrations(
  executor: PostgresMigrationExecutor,
  migrationFilePaths: readonly string[] = durableKernelMigrationFilePaths,
): Promise<void> {
  await executor.query(`
    CREATE TABLE IF NOT EXISTS ${durableKernelMigrationRegistryTable} (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  for (const filePath of migrationFilePaths) {
    const version = migrationVersionFromFilePath(filePath);
    const existing = await executor.query<{ version: string }>(
      `SELECT version FROM ${durableKernelMigrationRegistryTable} WHERE version = $1`,
      [version],
    );

    if ((existing.rows?.length ?? 0) > 0) {
      continue;
    }

    const sql = await readDurableKernelMigration(filePath);

    try {
      if (executor.exec) {
        await executor.exec(sql);
      } else {
        await executor.query(sql);
      }
    } catch (error) {
      try {
        await executor.query('ROLLBACK');
      } catch {
        // Preserve the migration error when the executor has already rolled back.
      }
      throw error;
    }

    await executor.query(
      `INSERT INTO ${durableKernelMigrationRegistryTable} (version) VALUES ($1) ON CONFLICT (version) DO NOTHING`,
      [version],
    );
  }
}

function migrationVersionFromFilePath(filePath: string): string {
  return basename(filePath, '.sql');
}
