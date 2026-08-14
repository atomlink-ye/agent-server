#!/usr/bin/env node

import process from 'node:process';
import { spawnSync } from 'node:child_process';

const behavior = run('pnpm', [
  'exec',
  'vitest',
  'run',
  '--config',
  'vitest.integration.config.ts',
  '--no-file-parallelism',
  'tests/integration/product-api-v1-oi38.integration.test.ts',
  '-t',
  'creates through real MCP',
]);
if (behavior.status !== 0) process.exit(classifyRawFailure(behavior));

const bootstrap = run('node', ['scripts/ci/check-work-bootstrap-boundary.mjs']);
if (
  bootstrap.status === 2 &&
  `${bootstrap.stdout ?? ''}\n${bootstrap.stderr ?? ''}`.includes(
    'work_bootstrap_boundary_missing:',
  )
) {
  console.error('WORK_ACCEPTANCE_MISSING[work_mcp_bootstrap_checker_missing]');
  process.exit(1);
}
process.exit(bootstrap.status === 0 ? 0 : classifyRawFailure(bootstrap));

function run(executable, argv) {
  const result = spawnSync(executable, argv, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
  });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  return result;
}

function classifyRawFailure(result) {
  return result.status === null || result.signal !== null || result.error
    ? 1
    : result.status;
}
