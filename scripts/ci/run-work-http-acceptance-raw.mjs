#!/usr/bin/env node

import process from 'node:process';
import { spawnSync } from 'node:child_process';

if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
  console.error('WORK_ACCEPTANCE_MISSING[work_http_database_unavailable]');
  process.exit(1);
}

const result = spawnSync(
  'pnpm',
  [
    'exec',
    'vitest',
    'run',
    '--config',
    'vitest.integration.config.ts',
    '--no-file-parallelism',
    'tests/integration/product-api-v1-oi38.integration.test.ts',
    '-t',
    'requires owner positive control|fails closed|runs the real HTTP',
  ],
  {
    cwd: process.cwd(),
    env: { ...process.env, REAL_POSTGRES_REQUIRED: '1' },
    encoding: 'utf8',
  },
);
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
process.exit(
  result.status === null || result.signal || result.error ? 1 : result.status,
);
