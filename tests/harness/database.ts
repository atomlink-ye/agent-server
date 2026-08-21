import { PGlite } from '@electric-sql/pglite';

import { applyDurableKernelMigrations } from '../../src/infrastructure/postgres/postgres.js';

export type HarnessDatabase = PGlite;

export type PgliteTestDatabase = Readonly<{
  db: HarnessDatabase;
  dispose(): Promise<void>;
}>;

export async function createPgliteTestDatabase(): Promise<PgliteTestDatabase> {
  const db = new PGlite();
  await applyDurableKernelMigrations(db);
  return {
    db,
    async dispose() {
      await db.close();
    },
  };
}
