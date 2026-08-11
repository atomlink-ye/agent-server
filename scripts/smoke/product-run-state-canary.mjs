import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const recorder = fileURLToPath(
  new URL('../record/product-projection-real-run.mjs', import.meta.url),
);
const baseUrl =
  process.env.AGENT_SERVER_URL ??
  process.env.AGENT_SERVER_BASE_URL ??
  'http://agent-server:3000';
const child = spawn(
  process.execPath,
  [
    recorder,
    '--mode',
    'state-canary',
    '--scenario',
    'lead-never-accept',
    '--base-url',
    baseUrl,
  ],
  { env: process.env, stdio: 'inherit' },
);
child.once('error', (error) => {
  process.stderr.write(`state_canary_spawn_failed:${error.message}\n`);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  if (signal) {
    process.stderr.write(`state_canary_signal:${signal}\n`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
