import {
  applyDurableKernelMigrations,
  createPostgresPool,
} from '../infrastructure/postgres/postgres.js';
import { ensureServiceAccountWorkspaces } from '../infrastructure/postgres/postgres-service-account-workspace-bootstrap.js';
import type { AppConfig } from '../shared/config.js';
import type { Logger } from '../shared/observability/logger.js';

export interface Infrastructure {
  readonly pool: ReturnType<typeof createPostgresPool>;
}

/** Creates the durable infrastructure every application graph shares. */
export async function createInfrastructure(
  config: Pick<AppConfig, 'serviceAccounts'>,
  logger: Logger,
): Promise<Infrastructure> {
  const pool = createPostgresPool();
  pool.on('error', (error) => {
    logger.log('error', 'postgres.pool.error', {
      error_name: error instanceof Error ? error.name : 'UnknownError',
    });
  });
  await applyDurableKernelMigrations(pool);
  await ensureServiceAccountWorkspaces(pool, config.serviceAccounts ?? []);
  return Object.freeze({ pool });
}
