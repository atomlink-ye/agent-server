#!/usr/bin/env node

import process from 'node:process';
import { spawnSync } from 'node:child_process';

const kind = option('--kind');
const separator = process.argv.indexOf('--');
if (separator < 0 || !process.argv[separator + 1]) fail('missing_command', 2);

const classifications = {
  'http-projection': 'work_http_projection_installer_missing',
  'mcp-registration': 'work_mcp_registration_missing:product_work_create',
};
const exactMarker = classifications[kind];
if (!exactMarker) fail(`unknown_classification:${kind}`, 2);

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

const rawExit = result.status ?? 125;
const combined = `${stdout}\n${stderr}`;
if (rawExit !== 0 && combined.includes(exactMarker)) {
  console.error(`work_acceptance_missing:kind=${kind}:marker=${exactMarker}`);
  process.exit(2);
}
process.exit(rawExit);

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) fail(`missing_option:${name}`, 2);
  return process.argv[index + 1];
}

function fail(message, exit) {
  console.error(`work_acceptance_classifier_invalid:${message}`);
  process.exit(exit);
}
