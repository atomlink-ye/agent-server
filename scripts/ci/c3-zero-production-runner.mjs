import { access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { zeroExecutionMarker, zeroExecutionOutcome } from './c3-c4-zero-execution.mjs';

function runChild(argv) {
  try {
    const result = spawnSync(argv[0], argv.slice(1), {
      encoding: null,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return {
      spawnError: result.error ?? null,
      code: result.status,
      signal: result.signal,
      stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0),
      stderr: Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.alloc(0),
    };
  } catch (error) {
    return { spawnError: error, code: null, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  }
}

function outcomeWithOutput(outcome, stdout = Buffer.alloc(0), stderr = Buffer.alloc(0)) {
  return { ...outcome, stdout, stderr };
}

function parseObservedCount(stdout) {
  const text = stdout.toString('utf8');
  const countLines = text.split(/\r?\n/u).filter((line) => line.startsWith('observed-count:'));
  const validLines = countLines.filter((line) => /^observed-count:\d+$/u.test(line));
  if (countLines.length !== 1 || validLines.length !== 1) return null;
  return Number(validLines[0].slice('observed-count:'.length));
}

export async function runZeroProductionArm(argv) {
  const [kind, mode, ...rest] = argv;
  if (!kind || (mode !== '--target' && mode !== '--command') || rest.length === 0)
    return outcomeWithOutput({ process: 2, marker: zeroExecutionMarker(kind ?? '', 'instrument', 'usage') });

  if (mode === '--target') {
    try {
      await access(rest[0]);
    } catch {
      return outcomeWithOutput({ process: 2, marker: zeroExecutionMarker(kind, 'target-unavailable', 'target-missing') });
    }
    return outcomeWithOutput({ process: 2, marker: zeroExecutionMarker(kind, 'instrument', 'count-unavailable') });
  }

  const result = await runChild(rest);
  if (result.spawnError)
    return outcomeWithOutput(
      { process: 2, marker: zeroExecutionMarker(kind, 'target-unavailable', 'spawn-failure') },
      result.stdout,
      result.stderr,
    );
  const observedCount = parseObservedCount(result.stdout);
  if (result.signal || result.code !== 0 || observedCount === null)
    return outcomeWithOutput(
      { process: 2, marker: zeroExecutionMarker(kind, 'instrument', 'count-unavailable') },
      result.stdout,
      result.stderr,
    );
  return outcomeWithOutput(zeroExecutionOutcome({
    kind,
    observedCount,
    observedCountSource: 'production-runner-output',
  }), result.stdout, result.stderr);
}

function forwardOutcome(outcome) {
  if (outcome.stdout.length > 0) process.stdout.write(outcome.stdout);
  if (outcome.stderr.length > 0) process.stderr.write(outcome.stderr);
  if (!outcome.marker) return;
  if (outcome.stdout.length > 0 && outcome.stdout[outcome.stdout.length - 1] !== 0x0a)
    process.stdout.write(Buffer.from('\n'));
  process.stdout.write(Buffer.from(`${outcome.marker}\n`));
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  runZeroProductionArm(process.argv.slice(2)).then((outcome) => {
    forwardOutcome(outcome);
    process.exitCode = outcome.process;
  }).catch(() => {
    process.stdout.write(`${zeroExecutionMarker('', 'instrument', 'runner-error')}\n`);
    process.exitCode = 2;
  });
}
