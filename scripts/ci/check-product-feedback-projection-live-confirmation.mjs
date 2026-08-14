#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RUNNER = join(
  ROOT,
  'scripts/ci/run-product-feedback-projection-live-confirmation.mjs',
);

function fail(reason) {
  throw new Error(`live_confirmation_shape_check_failed:${reason}`);
}

async function invoke(args = []) {
  return new Promise((resolvePromise) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', RUNNER, ...args],
      {
        cwd: ROOT,
        env: {
          PATH: process.env.PATH ?? '',
          NODE_PATH: process.env.NODE_PATH ?? '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => resolvePromise({ code, stdout, stderr }));
  });
}

const source = await readFile(RUNNER, 'utf8');
for (const marker of [
  'FEEDBACK_PROJECTION_LIVE_UNBLOCK_CONFIRMATION',
  'execFile',
  'rev-parse',
  'captureProductRun',
  "validateRecording(directory, 'product')",
  'ProductWorkRunResponseSchema.safeParse',
  'ProductRunTraceResponseSchema.safeParse',
  'fresh_db_feedback_nonempty_not_exactly_one',
  'fresh_db_api_feedback_or_status_mismatch',
]) {
  if (!source.includes(marker)) fail(`marker_missing:${marker}`);
}
for (const forbidden of [
  'readFile(resolve(bundleDirectory',
  'bundleDirectory',
]) {
  if (source.includes(forbidden))
    fail(`caller_bundle_path_present:${forbidden}`);
}

const missing = await invoke();
if (missing.code !== 2) fail(`missing_env_exit:${missing.code}`);
const missingResult = JSON.parse(missing.stdout);
if (
  missingResult.arm !== 'FEEDBACK_PROJECTION_LIVE_UNBLOCK_CONFIRMATION' ||
  missingResult.status !== 'MISSING' ||
  missingResult.exit_code !== 2
)
  fail('missing_env_verdict');
const bundleArg = await invoke(['--bundle-dir', '/tmp/caller-bundle']);
if (bundleArg.code !== 2) fail(`bundle_arg_exit:${bundleArg.code}`);
const bundleResult = JSON.parse(bundleArg.stdout);
if (
  bundleResult.status !== 'MISSING' ||
  !String(bundleResult.reason).includes('caller_arguments_forbidden')
)
  fail('bundle_arg_accepted');

process.stdout.write(
  `${JSON.stringify({ arm: 'FEEDBACK_PROJECTION_LIVE_UNBLOCK_CONFIRMATION', status: 'LIVE_CONFIRMATION_PATH_STATIC_AND_CALLABLE', missing_env_exit: missing.code, caller_bundle_exit: bundleArg.code, fresh_capture_evaluator: 'captureProductRun -> read-only fresh bundle -> validateRecording -> current work-run/trace schemas -> identity/attempt/candidate evaluation' })}\n`,
);
