#!/usr/bin/env node

import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { classifyWorkAcceptanceOutcome } from './work-acceptance-outcome.mjs';

const kind = option('--kind');
const separator = process.argv.indexOf('--');
if (separator < 0 || !process.argv[separator + 1]) fail('missing_command', 2);

const classifications = {
  'http-projection': [
    'work_http_projection_installer_missing',
    'work_http_database_unavailable',
    'work_http_environment_unavailable',
    'work_http_zero_execution',
    'work_http_instrument_underexecution',
  ],
  'mcp-registration': [
    'work_mcp_registration_missing:product_work_create',
    'work_mcp_bootstrap_checker_missing',
    'work_mcp_database_unavailable',
    'work_mcp_environment_unavailable',
    'work_mcp_zero_execution',
    'work_mcp_instrument_underexecution',
  ],
};
const exactMarkers = classifications[kind];
if (!exactMarkers) fail(`unknown_classification:${kind}`, 2);

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

const rawExit = result.status;
console.error(
  `work_acceptance_child_result:status=${rawExit ?? 'null'}:signal=${result.signal ?? 'none'}:error=${result.error?.code ?? 'none'}`,
);
const combined = `${stdout}\n${stderr}`;
const matchedMarker = exactMarkers.find((exactMarker) => {
  const taggedMarker = `WORK_ACCEPTANCE_MISSING[${exactMarker}]`;
  return combined
    .split(/\r?\n/)
    .some((line) =>
      new RegExp(
        `(?:^|[^A-Za-z0-9_])${escapeRegExp(taggedMarker)}(?:$|[^A-Za-z0-9_])`,
      ).test(line),
    );
});
const markerClass = matchedMarker ? 'exact-selected-kind' : 'absent';
const classifierExit = classifyWorkAcceptanceOutcome({
  status: rawExit,
  signal: result.signal,
  error: result.error?.code ?? null,
  markerClass,
});
if (classifierExit === 2) {
  console.error(`work_acceptance_missing:kind=${kind}:marker=${matchedMarker}`);
}
process.exit(classifierExit);

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) fail(`missing_option:${name}`, 2);
  return process.argv[index + 1];
}

function fail(message, exit) {
  console.error(`work_acceptance_classifier_invalid:${message}`);
  process.exit(exit);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
