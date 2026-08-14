import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

const workspace = resolve(process.cwd());
const outcomeDirectory = resolve('.local/phase-c/runtime-demo');
const outcomePath = resolve(outcomeDirectory, 'outcome.json');
const stdoutPath = resolve(outcomeDirectory, 'phase-c-real-run.stdout.log');
const stderrPath = resolve(outcomeDirectory, 'phase-c-real-run.stderr.log');
const checkpointPath = resolve(
  process.env.FOUNDATION_RUN_CHECKPOINT ??
    '.local/phase-c/runtime-demo/real-run-checkpoint.json',
);
const invocationId = randomUUID();
const serviceToken =
  process.env.AGENT_SERVER_SERVICE_TOKEN ?? 'token-local-dev';
const proofPath = resolve(
  process.env.FOUNDATION_PROOF_RECORD ?? '.local/phase-c/proof-record.json',
);
const readyUrl = new URL(
  '/health/ready',
  process.env.AGENT_SERVER_BASE_URL ?? 'http://127.0.0.1:3000',
);
const monitorState = {
  lastReason: 'child_exited_without_terminal',
};

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
  terminal_fallback: {
    status: 'waiting_for_checkpoint',
    checkpoint_path: relative(workspace, checkpointPath),
    observed_at: null,
    monitor_errors: [],
  },
};

await mkdir(outcomeDirectory, { recursive: true });
try {
  await mkdir(dirname(checkpointPath), { recursive: true, mode: 0o700 });
  await chmod(dirname(checkpointPath), 0o700);
  await unlink(checkpointPath).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
} catch {
  addMonitorError('checkpoint_setup', 'checkpoint_setup_failed');
}
await writeOutcome();

outcome.runtime_start = { started_at: new Date().toISOString() };
await writeOutcome();
outcome.readiness = {
  ...outcome.readiness,
  status: 'polling',
  started_at: new Date().toISOString(),
};
await writeOutcome();
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
const monitorController = new AbortController();
const realRunPromise = run(
  process.execPath,
  ['scripts/foundation/phase-c-real-run.mjs'],
  {
    env: {
      ...process.env,
      FOUNDATION_RUN_CHECKPOINT: checkpointPath,
      FOUNDATION_RUN_INVOCATION_ID: invocationId,
    },
  },
);
const terminalMonitorPromise = monitorTerminalFallback(
  monitorController.signal,
).catch(async () => {
  addMonitorError('monitor', 'monitor_failed');
  await safeMonitorWrite();
});
const realRun = await realRunPromise;
await waitForMonitorGrace(terminalMonitorPromise);
monitorController.abort();
await terminalMonitorPromise.catch(() => undefined);
if (outcome.terminal_fallback.status === 'waiting_for_checkpoint') {
  outcome.terminal_fallback = {
    ...outcome.terminal_fallback,
    status: 'not_observed',
    reason: monitorState.lastReason,
  };
}
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

async function monitorTerminalFallback(signal) {
  while (!signal.aborted) {
    let checkpoint;
    try {
      checkpoint = await readCheckpoint();
    } catch (error) {
      if (signal.aborted) return;
      await recordMonitorError(
        'checkpoint',
        error?.code === 'invalid_checkpoint'
          ? 'invalid_checkpoint'
          : 'checkpoint_read_failed',
      );
      monitorState.lastReason =
        error?.code === 'invalid_checkpoint'
          ? 'invalid_checkpoint'
          : 'checkpoint_read_failed';
      if (!(await delayWithAbort(signal))) return;
      continue;
    }
    if (checkpoint === null) {
      if (!(await delayWithAbort(signal))) return;
      continue;
    }

    let response;
    try {
      response = await fetch(
        new URL(
          `/api/v1/works/${checkpoint.work_id}/runs/${checkpoint.work_run_id}`,
          process.env.AGENT_SERVER_BASE_URL ?? 'http://127.0.0.1:3000',
        ),
        {
          headers: {
            authorization: `Bearer ${serviceToken}`,
            accept: 'application/json',
          },
          signal,
        },
      );
    } catch (error) {
      if (signal.aborted) return;
      await recordMonitorError('terminal_fetch', 'transport_error');
      monitorState.lastReason = 'transport_error';
      if (!(await delayWithAbort(signal))) return;
      continue;
    }
    const body = await response.json().catch(() => null);
    if (
      response.status === 503 &&
      body?.error?.code === 'projection_unavailable'
    ) {
      if (!(await delayWithAbort(signal))) return;
      continue;
    }
    if (!response.ok) {
      const errorCode =
        response.status >= 400 && response.status < 500
          ? 'http_4xx'
          : 'http_status';
      await recordMonitorError('terminal_fetch', errorCode);
      monitorState.lastReason = errorCode;
      if (!(await delayWithAbort(signal))) return;
      continue;
    }
    const product = parseTerminalResponse(body, checkpoint);
    if (product === null) {
      await recordMonitorError('terminal_fetch', 'response_shape_invalid');
      monitorState.lastReason = 'response_shape_invalid';
      if (!(await delayWithAbort(signal))) return;
      continue;
    }
    if (
      product.product_state !== 'complete' &&
      product.product_state !== 'problem'
    ) {
      if (!(await delayWithAbort(signal))) return;
      continue;
    }
    const resultSummary = product.result_summary;
    const terminalFallback = {
      status: 'observed',
      product_state: product.product_state,
      problem_kind: product.problem_kind,
      result_capture_status: product.result_capture_status,
      result_summary_present: typeof resultSummary === 'string',
      expected_marker_sha256: checkpoint.expected_marker_sha256,
      result_summary_matches_expected_marker:
        typeof resultSummary === 'string' &&
        createHash('sha256').update(resultSummary).digest('hex') ===
          checkpoint.expected_marker_sha256,
      work_id: checkpoint.work_id,
      work_run_id: checkpoint.work_run_id,
      observed_at: new Date().toISOString(),
      monitor_errors: outcome.terminal_fallback.monitor_errors,
    };
    if (typeof resultSummary === 'string')
      terminalFallback.result_summary_sha256 = createHash('sha256')
        .update(resultSummary)
        .digest('hex');
    outcome.terminal_fallback = terminalFallback;
    await safeMonitorWrite();
    return;
  }
}

async function waitForMonitorGrace(monitorPromise) {
  let timeout;
  const grace = new Promise((resolvePromise) => {
    timeout = setTimeout(resolvePromise, 2000);
  });
  try {
    await Promise.race([monitorPromise, grace]);
  } finally {
    clearTimeout(timeout);
  }
}

async function readCheckpoint() {
  let raw;
  try {
    raw = await readFile(checkpointPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    const error = new Error('invalid_checkpoint');
    error.code = 'invalid_checkpoint';
    throw error;
  }
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) =>
        ![
          'schema',
          'version',
          'invocation_id',
          'work_id',
          'work_run_id',
          'expected_marker_sha256',
          'created_at',
        ].includes(key),
    ) ||
    value.schema !== 'agent-server.foundation.phase-c-run-checkpoint' ||
    value.version !== 1 ||
    value.invocation_id !== invocationId ||
    !isNonEmptyString(value.work_id) ||
    !isNonEmptyString(value.work_run_id) ||
    !/^[0-9a-f]{64}$/iu.test(value.expected_marker_sha256) ||
    !isNonEmptyString(value.created_at) ||
    Number.isNaN(Date.parse(value.created_at))
  ) {
    const error = new Error('invalid_checkpoint');
    error.code = 'invalid_checkpoint';
    throw error;
  }
  return value;
}

function parseTerminalResponse(value, checkpoint) {
  const workRun = value?.work_run;
  if (
    value?.projection_status !== 'internally_anchored' ||
    value?.work?.id !== checkpoint.work_id ||
    workRun?.id !== checkpoint.work_run_id ||
    workRun?.work_id !== checkpoint.work_id ||
    !['running', 'needs_you', 'complete', 'problem', 'not_captured'].includes(
      workRun?.product_state,
    ) ||
    ![null, 'failed', 'cancelled', 'not_captured'].includes(
      workRun?.problem_kind,
    ) ||
    !['present', 'not_present', 'redacted', 'not_captured'].includes(
      workRun?.result_capture_status,
    ) ||
    !(
      typeof workRun?.result_summary === 'string' ||
      workRun?.result_summary === null
    )
  )
    return null;
  return workRun;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function delayWithAbort(signal) {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolvePromise) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolvePromise(true);
    }, 1000);
    function onAbort() {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      resolvePromise(false);
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function recordMonitorError(stage, code) {
  addMonitorError(stage, code);
  await safeMonitorWrite();
}

function addMonitorError(stage, code) {
  const existing = outcome.terminal_fallback.monitor_errors.find(
    (item) => item.stage === stage && item.code === code,
  );
  if (existing) {
    existing.count += 1;
    existing.last_at = new Date().toISOString();
  } else {
    outcome.terminal_fallback.monitor_errors.push({
      stage,
      code,
      count: 1,
      last_at: new Date().toISOString(),
    });
  }
}

async function safeMonitorWrite() {
  try {
    await writeOutcome();
  } catch {
    addMonitorError('outcome', 'write_failed');
  }
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

let outcomeWriteQueue = Promise.resolve();

function writeOutcome() {
  const contents = `${JSON.stringify(outcome, null, 2)}\n`;
  const previousWrite = outcomeWriteQueue.catch(() => undefined);
  const currentWrite = previousWrite.then(() =>
    writeFile(outcomePath, contents, { mode: 0o600 }),
  );
  outcomeWriteQueue = currentWrite.catch(() => undefined);
  return currentWrite;
}

function run(
  command,
  argumentsList,
  { env = process.env, inherit = false } = {},
) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, argumentsList, {
      cwd: workspace,
      env,
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
