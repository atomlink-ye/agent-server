#!/usr/bin/env tsx

import {
  applyDurableKernelMigrations,
  createPostgresPool,
} from '../../../src/infrastructure/postgres/postgres.js';

const pool = createPostgresPool();

try {
  await applyDurableKernelMigrations(pool);
  process.stdout.write(
    `${JSON.stringify({ applied: true, latest: '0030_work_collaboration_kernel' })}\n`,
  );
} finally {
  await pool.end();
}
