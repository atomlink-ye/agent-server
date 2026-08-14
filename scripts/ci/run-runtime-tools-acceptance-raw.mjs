#!/usr/bin/env node

import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { runVitestTarget } from './work-acceptance-raw-support.mjs';
import { requireRuntimeToolsCanonicalInputs } from './runtime-tools-acceptance-inputs.mjs';

if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
  console.error('RUNTIME_TOOLS_MISSING[runtime_tools_database_unavailable]');
  process.exit(1);
}
if (!(await requireRuntimeToolsCanonicalInputs())) process.exit(1);

const originalConsoleError = console.error;
console.error = (...values) =>
  originalConsoleError(
    ...values.map((value) =>
      typeof value === 'string'
        ? value.replaceAll('WORK_ACCEPTANCE_MISSING[', 'RUNTIME_TOOLS_MISSING[')
        : value,
    ),
  );
let behaviorExit;
try {
  behaviorExit = runVitestTarget({
    kind: 'runtime-tools',
    expectedMinCount: 1,
    zeroExecutionMarker: 'runtime_tools_zero_execution',
    underExecutionMarker: 'runtime_tools_instrument_underexecution',
    pattern: 'calls Work and Memory through the composed runtime tool registry',
  });
} finally {
  console.error = originalConsoleError;
}
if (behaviorExit !== 0) process.exit(behaviorExit);

const boundary = spawnSync(
  'node',
  ['scripts/ci/check-runtime-tool-host-boundary.mjs'],
  { cwd: process.cwd(), env: process.env, encoding: 'utf8' },
);
process.stdout.write(boundary.stdout ?? '');
process.stderr.write(boundary.stderr ?? '');
if (
  boundary.status === 2 &&
  `${boundary.stdout ?? ''}\n${boundary.stderr ?? ''}`.includes(
    'runtime_tool_host_boundary_missing:',
  )
) {
  console.error(
    'RUNTIME_TOOLS_MISSING[runtime_tools_host_boundary_checker_missing]',
  );
  process.exit(1);
}
process.exit(
  boundary.status === null || boundary.signal || boundary.error
    ? 1
    : boundary.status,
);
