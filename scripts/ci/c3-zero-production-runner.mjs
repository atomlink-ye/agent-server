import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { zeroExecutionMarker, zeroExecutionOutcome } from './c3-c4-zero-execution.mjs';

function runChild(argv) {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    child.on('error', (error) => resolve({ spawnError: error, stdout: Buffer.concat(chunks) }));
    child.on('close', (code, signal) => resolve({ code, signal, stdout: Buffer.concat(chunks) }));
  });
}

export async function runZeroProductionArm(argv) {
  const [kind, mode, ...rest] = argv;
  if (!kind || (mode !== '--target' && mode !== '--command') || rest.length === 0)
    return { process: 2, marker: zeroExecutionMarker(kind ?? '', 'instrument', 'usage') };

  if (mode === '--target') {
    try {
      await access(rest[0]);
    } catch {
      return { process: 2, marker: zeroExecutionMarker(kind, 'target-unavailable', 'target-missing') };
    }
    return { process: 2, marker: zeroExecutionMarker(kind, 'instrument', 'count-unavailable') };
  }

  const result = await runChild(rest);
  if (result.spawnError)
    return { process: 2, marker: zeroExecutionMarker(kind, 'target-unavailable', 'spawn-failure') };
  const match = result.stdout.toString('utf8').match(/^observed-count:(\d+)$/mu);
  if (!match)
    return { process: 2, marker: zeroExecutionMarker(kind, 'instrument', 'count-unavailable') };
  return zeroExecutionOutcome({
    kind,
    observedCount: Number(match[1]),
    observedCountSource: 'production-runner-output',
  });
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  runZeroProductionArm(process.argv.slice(2)).then((outcome) => {
    if (outcome.marker) process.stdout.write(`${outcome.marker}\n`);
    process.exitCode = outcome.process;
  }).catch(() => {
    process.stdout.write(`${zeroExecutionMarker('', 'instrument', 'runner-error')}\n`);
    process.exitCode = 2;
  });
}
