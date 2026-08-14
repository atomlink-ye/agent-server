#!/usr/bin/env node

import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { classifyWorkAcceptanceOutcome } from './work-acceptance-outcome.mjs';

const markers = [
  'runtime_tools_database_unavailable',
  'runtime_tools_environment_unavailable',
  'runtime_tools_zero_execution',
  'runtime_tools_instrument_underexecution',
  'runtime_tools_instrument_skip_or_todo',
  'runtime_work_registration_missing',
  'runtime_memory_registration_missing',
  'runtime_tools_host_boundary_checker_missing',
];
const separator = process.argv.indexOf('--');
if (separator < 0 || !process.argv[separator + 1]) fail('missing_command', 2);

const executable = process.argv[separator + 1];
const argv = process.argv.slice(separator + 2);
const result = spawnSync(executable, argv, {
  cwd: process.cwd(),
  env: process.env,
  encoding: 'utf8',
});
const stdout = result.stdout ?? '';
const stderr = result.stderr ?? '';
process.stdout.write(stdout);
process.stderr.write(stderr);
console.error(
  `runtime_tools_child_result:status=${result.status ?? 'null'}:signal=${result.signal ?? 'none'}:error=${result.error?.code ?? 'none'}`,
);
const combined = `${stdout}\n${stderr}`;
const matchedMarker = markers.find((marker) =>
  combined
    .split(/\r?\n/)
    .some((line) =>
      new RegExp(
        `(?:^|[^A-Za-z0-9_])${escapeRegExp(`RUNTIME_TOOLS_MISSING[${marker}]`)}(?:$|[^A-Za-z0-9_])`,
      ).test(line),
    ),
);
const classifierExit = classifyWorkAcceptanceOutcome({
  status: result.status,
  signal: result.signal,
  error: result.error?.code ?? null,
  markerClass: matchedMarker ? 'exact-selected-kind' : 'absent',
});
if (classifierExit === 2)
  console.error(`runtime_tools_missing:marker=${matchedMarker}`);
process.exit(classifierExit);

function fail(message, exit) {
  console.error(`runtime_tools_classifier_invalid:${message}`);
  process.exit(exit);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
