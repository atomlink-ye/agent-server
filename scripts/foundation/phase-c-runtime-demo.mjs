import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

const workspace = resolve(process.cwd());
const outcomeDirectory = resolve('.local/phase-c/runtime-demo');
const outcomePath = resolve(outcomeDirectory, 'outcome.json');
const stdoutPath = resolve(outcomeDirectory, 'phase-c-real-run.stdout.log');
const stderrPath = resolve(outcomeDirectory, 'phase-c-real-run.stderr.log');
const proofPath = resolve(
  process.env.FOUNDATION_PROOF_RECORD ?? '.local/phase-c/proof-record.json',
);
const readyUrl = new URL(
  '/health/ready',
  process.env.AGENT_SERVER_BASE_URL ?? 'http://127.0.0.1:3000',
);

const outcome = {
  schema: 'agent-server.foundation.phase-c-runtime-demo-outcome',
  version: 1,
  workspace: relative(workspace, workspace) || '.',
  proof: { path: relative(workspace, proofPath), exists: false },
  readiness: {
    status: 'not_started',
    first_http_200_at: null,
    response_body: null,
  },
  real_run: {
    status: 'not_started',
    stdout_path: relative(workspace, stdoutPath),
    stderr_path: relative(workspace, stderrPath),
    exit_code: null,
  },
};

await mkdir(outcomeDirectory, { recursive: true });
await writeOutcome();

outcome.runtime_start = { started_at: new Date().toISOString() };
await writeOutcome();
const start = await run('pnpm', ['dev:runtime'], { inherit: true });
outcome.runtime_start = { ...outcome.runtime_start, exit_code: start.exitCode };
await writeOutcome();
if (start.exitCode !== 0) await finish(start.exitCode);

const readiness = await waitForReady();
outcome.readiness = readiness;
await writeOutcome();
if (readiness.status !== 'ready') await finish(70);

outcome.real_run = {
  status: 'started',
  started_at: new Date().toISOString(),
  stdout_path: relative(workspace, stdoutPath),
  stderr_path: relative(workspace, stderrPath),
};
await writeOutcome();
const realRun = await run(process.execPath, [
  'scripts/foundation/phase-c-real-run.mjs',
]);
await writeFile(stdoutPath, realRun.stdout, { mode: 0o600 });
await writeFile(stderrPath, realRun.stderr, { mode: 0o600 });
outcome.real_run = {
  status: 'completed',
  exit_code: realRun.exitCode,
  stdout_path: relative(workspace, stdoutPath),
  stderr_path: relative(workspace, stderrPath),
};
await recordProof();
await writeOutcome();

process.stdout.write(realRun.stdout);
process.stderr.write(realRun.stderr);
await finish(realRun.exitCode);

async function finish(exitCode) {
  process.stdout.write(
    `${JSON.stringify({
      phase_c_runtime_demo: outcome,
      outcome_path: relative(workspace, outcomePath),
    })}\n`,
  );
  process.exit(exitCode);
}

async function waitForReady() {
  for (let attempt = 1; attempt <= 180; attempt += 1) {
    try {
      const response = await fetch(readyUrl);
      const body = await response.text();
      if (response.status === 200) {
        return {
          status: 'ready',
          first_http_200_at: new Date().toISOString(),
          attempt,
          response_body: body,
        };
      }
    } catch {
      // The fixed readiness window includes startup transport failures.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
  }
  return { status: 'not_ready', attempts: 180 };
}

async function recordProof() {
  if (!existsSync(proofPath)) return;
  const contents = await readFile(proofPath);
  outcome.proof = {
    path: relative(workspace, proofPath),
    exists: true,
    sha256: createHash('sha256').update(contents).digest('hex'),
    result: JSON.parse(contents.toString('utf8')),
  };
}

async function writeOutcome() {
  await writeFile(outcomePath, `${JSON.stringify(outcome, null, 2)}\n`, {
    mode: 0o600,
  });
}

function run(command, argumentsList, { inherit = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, argumentsList, {
      cwd: workspace,
      env: process.env,
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    if (inherit) {
      child.once('error', reject);
      child.once('exit', (code, signal) =>
        resolvePromise({ exitCode: code ?? (signal ? 1 : 0) }),
      );
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      resolvePromise({
        exitCode: code ?? (signal ? 1 : 0),
        stdout,
        stderr,
      }),
    );
  });
}
