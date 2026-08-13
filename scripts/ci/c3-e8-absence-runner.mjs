import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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

function parseArgs(argv) {
  const [kind, evidenceFlag, evidenceDirectory] = argv;
  if (!kind || evidenceFlag !== '--evidence' || !evidenceDirectory) {
    throw new Error('usage: <kind> --evidence <directory>');
  }
  if (!Object.hasOwn(TARGETS, kind)) throw new Error(`unknown kind: ${kind}`);
  return { kind, evidenceDirectory: resolve(evidenceDirectory) };
}

function writeEvidence(directory, filename, contents) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, filename), contents);
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
  writeEvidence(
    directory,
    'raw-status.json',
    `${JSON.stringify({ ...status, spawnError }, null, 2)}\n`,
  );
  return { ...status, spawnError, stdout, stderr };
}

async function main() {
  const { kind, evidenceDirectory } = parseArgs(process.argv.slice(2));
  const target = resolve(process.cwd(), TARGETS[kind]);
  let targetAbsent = false;
  try {
    statSync(target);
  } catch (error) {
    if (error?.code === 'ENOENT') targetAbsent = true;
    else throw error;
  }
  writeEvidence(
    evidenceDirectory,
    'structural-status.json',
    `${JSON.stringify({ kind, target, targetAbsent }, null, 2)}\n`,
  );
  if (!targetAbsent) {
    process.stderr.write(`c3_e8_runner:expected-input-still-present:${target}\n`);
    process.exitCode = 1;
    return;
  }

  process.stderr.write(`c3_e8_runner:structural-absence-confirmed:${target}\n`);
  const status = await runFixedCommand(evidenceDirectory);
  const marker = C3_E8_INPUT_MARKERS[kind];
  const currentOutput = readFileSync(resolve(evidenceDirectory, 'raw.stdout'));
  if (currentOutput.length > 0 && currentOutput.at(-1) !== 10) process.stdout.write('\n');
  process.stdout.write(`${marker}\n`);
  writeEvidence(evidenceDirectory, 'marker-status.json', `${JSON.stringify({ marker, emitted: true })}\n`);

  if (status.signal) {
    process.kill(process.pid, status.signal);
    return;
  }
  process.exitCode = status.code ?? 1;
}

try {
  await main();
} catch (error) {
  process.stderr.write(`c3_e8_runner:error:${error.message}\n`);
  process.exitCode = 1;
}
