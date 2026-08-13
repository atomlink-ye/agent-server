import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

import {
  C3_E8_INPUT_MARKERS,
  C3_E8_KINDS,
} from './c3-e8-classifier.mjs';

const FIXED_VITEST_ARGS = [
  'exec',
  'vitest',
  '--config',
  'vitest.web.config.ts',
  '--run',
  'apps/web/components/work/work-list.browser.test.tsx',
];

const TARGETS = Object.freeze({
  [C3_E8_KINDS.TEST_FILE_ABSENT]: 'apps/web/components/work/work-list.browser.test.tsx',
  [C3_E8_KINDS.IMPORTED_FIXTURE_ABSENT]:
    'apps/web/lib/__fixtures__/product-recordings/parallel-success-fa77ba9.json',
});

export function parseRunnerArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 3) {
    throw new Error('usage: <kind> --evidence <directory>');
  }
  const [kind, evidenceFlag, evidenceDirectory] = argv;
  if (!Object.hasOwn(TARGETS, kind) || evidenceFlag !== '--evidence' || evidenceDirectory.length === 0) {
    throw new Error('usage: <kind> --evidence <directory>');
  }
  return { kind, evidenceDirectory: resolve(evidenceDirectory) };
}

function writeEvidence(directory, filename, contents) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, filename), contents);
}

function targetIsAbsent(target) {
  try {
    statSync(target);
    return false;
  } catch (error) {
    if (error?.code === 'ENOENT') return true;
    throw error;
  }
}

export function runnerOutcome({ targetAbsent, targetStillAbsent, status }) {
  const rawCodeIsNonzeroInteger = Number.isInteger(status?.code) && status.code !== 0;
  const canEmitMarker =
    targetAbsent === true &&
    targetStillAbsent === true &&
    status?.spawnError === null &&
    status?.signal === null &&
    rawCodeIsNonzeroInteger;
  return {
    emitMarker: canEmitMarker,
    processExit: canEmitMarker ? status.code : 1,
  };
}

async function runFixedCommand(directory) {
  const stdoutChunks = [];
  const stderrChunks = [];
  let spawnError = null;
  const child = spawn('pnpm', FIXED_VITEST_ARGS, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CI: 'true',
      PLAYWRIGHT_BROWSERS_PATH: '/opt/playwright-browsers',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => {
    stdoutChunks.push(chunk);
    process.stdout.write(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderrChunks.push(chunk);
    process.stderr.write(chunk);
  });
  child.once('error', (error) => {
    spawnError = { code: error.code ?? null, message: error.message };
  });

  const status = await new Promise((resolveStatus) => {
    child.once('close', (code, signal) => resolveStatus({ code, signal }));
  });
  const stdout = Buffer.concat(stdoutChunks);
  const stderr = Buffer.concat(stderrChunks);
  writeEvidence(directory, 'raw.stdout', stdout);
  writeEvidence(directory, 'raw.stderr', stderr);
  writeEvidence(directory, 'raw-status.json', `${JSON.stringify({ ...status, spawnError }, null, 2)}\n`);
  return { ...status, spawnError, stdout, stderr };
}

async function main() {
  const { kind, evidenceDirectory } = parseRunnerArgs(process.argv.slice(2));
  const target = resolve(process.cwd(), TARGETS[kind]);
  const targetAbsent = targetIsAbsent(target);
  writeEvidence(
    evidenceDirectory,
    'structural-status.json',
    `${JSON.stringify({ kind, target, targetAbsent }, null, 2)}\n`,
  );
  if (!targetAbsent) {
    process.stderr.write(`c3_e8_runner:expected-input-still-present:${target}\n`);
    writeEvidence(evidenceDirectory, 'marker-status.json', '{"emitted":false,"reason":"input-present"}\n');
    process.exitCode = 1;
    return;
  }

  process.stderr.write(`c3_e8_runner:structural-absence-confirmed:${target}\n`);
  const status = await runFixedCommand(evidenceDirectory);
  const outcome = runnerOutcome({
    targetAbsent,
    targetStillAbsent: targetIsAbsent(target),
    status,
  });
  if (outcome.emitMarker) {
    const marker = C3_E8_INPUT_MARKERS[kind];
    process.stdout.write(`${marker}\n`);
    writeEvidence(evidenceDirectory, 'marker-status.json', `${JSON.stringify({ marker, emitted: true })}\n`);
  } else {
    writeEvidence(
      evidenceDirectory,
      'marker-status.json',
      `${JSON.stringify({ emitted: false, reason: 'unsafe-child-status' })}\n`,
    );
  }

  if (status.signal) {
    process.kill(process.pid, status.signal);
    return;
  }
  process.exitCode = outcome.processExit;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`c3_e8_runner:error:${error.message}\n`);
    process.exitCode = 1;
  }
}
