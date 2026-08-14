import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const MAX_HEALTH_LOGS = 20;
const MAX_HEALTH_OUTPUT_BYTES = 4096;
const MAX_LOG_BYTES = 64 * 1024;
const MAX_LOG_TAIL_BYTES = 8192;
const MAX_POOL_LOG_SEGMENT_BYTES = 8192;
const REDACTED = '[REDACTED]';

function redactDiagnosticText(value) {
  return String(value ?? '')
    .replace(/bearer\s+[a-z0-9._~+/=-]+/giu, `Bearer ${REDACTED}`)
    .replace(
      /((?:api[_-]?key|authorization|credential|password|secret|token)\s*[=:]\s*)([^\s,'"}]+)/giu,
      `$1${REDACTED}`,
    )
    .replace(/(postgres(?:ql)?(?:\+[^:]+)?:\/\/)[^\s]+/giu, `$1${REDACTED}`);
}

function boundedOutput(value) {
  return Buffer.from(redactDiagnosticText(value))
    .subarray(-MAX_HEALTH_OUTPUT_BYTES)
    .toString('utf8');
}

function boundedTail(value, maxBytes = MAX_LOG_TAIL_BYTES) {
  return Buffer.from(redactDiagnosticText(value))
    .subarray(-maxBytes)
    .toString('utf8');
}

function safeName(value, fallback = 'unknown') {
  const name = String(value ?? '').trim();
  return /^[a-z0-9][a-z0-9_.-]*$/iu.test(name) ? name : fallback;
}

function writeDiagnosticFile(path, value) {
  writeFileSync(path, `${String(value ?? '')}`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function safePsProjection(rawOutput) {
  const lines = String(rawOutput ?? '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const values = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      values.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch {
      // Table output is retained only as a bounded, redacted diagnostic tail.
      values.push({ line: boundedTail(line, 2048) });
    }
  }
  return values.map((value) =>
    value && typeof value === 'object' && 'line' in value
      ? { line: value.line }
      : {
          service_name: safeName(value?.Service ?? value?.service, 'unknown'),
          container_name: safeName(value?.Name ?? value?.name, 'unknown'),
          state: redactDiagnosticText(value?.State ?? value?.state ?? ''),
          health: redactDiagnosticText(value?.Health ?? value?.health ?? ''),
          exit_code: Number.isInteger(value?.ExitCode) ? value.ExitCode : null,
        },
  );
}

function safeServiceList(value) {
  return [
    ...new Set(
      String(value ?? '')
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => /^[a-z0-9][a-z0-9_.-]*$/iu.test(line)),
    ),
  ].sort();
}

function diagnosticFailure(identity, error) {
  return {
    phase: 'MISSING_EVIDENCE',
    status: 'MISSING_EVIDENCE',
    command_identity: identity,
    exit: Number.isInteger(error?.raw_exit) ? error.raw_exit : null,
    sanitized_tail: boundedTail(
      error?.sanitized_stderr_tail ?? error?.message ?? error,
    ),
  };
}

function poolErrorControlRecord(log) {
  const lines = String(log ?? '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(
      (line) =>
        /(?:pool|postgres|database)/iu.test(line) &&
        /(?:error|failed|closed|terminated|timeout|reset)/iu.test(line),
    );
  const redacted = lines.map((line) => redactDiagnosticText(line));
  const normalized = redacted.map((line) =>
    line
      .replace(/^\d{4}-\d\d-\d\d[T ][^ ]+\s*/u, '')
      .replace(/\b\d+\b/gu, '<n>')
      .trim(),
  );
  const signature = normalized[0]
    ? createHash('sha256').update(normalized[0]).digest('hex')
    : null;
  const timestamps = redacted
    .map(
      (line) =>
        line.match(/^(\d{4}-\d\d-\d\dT[^ ]+|\d{4}-\d\d-\d\d [^ ]+)/u)?.[1],
    )
    .filter(Boolean);
  return {
    schema: 'agent-server.foundation.phase-c-pool-error-control',
    version: 1,
    signature,
    count: redacted.length,
    first_timestamp: timestamps[0] ?? null,
    last_timestamp: timestamps.at(-1) ?? null,
    context_hash: createHash('sha256')
      .update(boundedTail(redacted.join('\n'), MAX_POOL_LOG_SEGMENT_BYTES))
      .digest('hex'),
    log_segment: boundedTail(redacted.join('\n'), MAX_POOL_LOG_SEGMENT_BYTES),
  };
}

export function safeContainerStateProjection(rawInspect) {
  const value =
    typeof rawInspect === 'string' ? JSON.parse(rawInspect) : rawInspect;
  const state = value.State ?? {};
  const health = state.Health ?? null;
  return {
    container_name: String(value.Name ?? '').replace(/^\//u, ''),
    service_name: safeName(
      value.Config?.Labels?.['com.docker.compose.service'],
      'unknown',
    ),
    state: {
      status: redactDiagnosticText(state.Status ?? null),
      running: state.Running === true,
      paused: state.Paused === true,
      restarting: state.Restarting === true,
      restart_count: Number.isInteger(value.RestartCount)
        ? value.RestartCount
        : 0,
      oom_killed: state.OOMKilled === true,
      dead: state.Dead === true,
      exit_code: Number.isInteger(state.ExitCode) ? state.ExitCode : null,
      started_at: state.StartedAt ?? null,
      finished_at: state.FinishedAt ?? null,
      health: health
        ? {
            status: redactDiagnosticText(health.Status ?? null),
            log: (health.Log ?? []).slice(-MAX_HEALTH_LOGS).map((entry) => ({
              output: boundedOutput(entry.Output),
              exit_code: Number.isInteger(entry.ExitCode)
                ? entry.ExitCode
                : null,
              start: entry.Start ?? null,
              end: entry.End ?? null,
            })),
          }
        : null,
    },
    mounts: (value.Mounts ?? []).map((mount) => ({
      destination: mount.Destination ?? null,
      read_only: mount.RW === false,
    })),
  };
}

/**
 * Run a nonzero evaluator, retain diagnostics, and always perform cleanup.
 * The evaluator's numeric exit is authoritative even if diagnostics fail.
 */
export function executeEvaluatorWithDiagnosticsBeforeCleanup({
  evaluator,
  diagnostics,
  cleanup,
  onLifecycle = () => {},
}) {
  let evaluation;
  let evaluatorError = null;
  try {
    evaluation = evaluator();
  } catch (error) {
    evaluatorError = error;
    evaluation = error?.evaluation ?? {
      exit: error?.raw_exit ?? error?.status,
    };
  }
  const evaluatorExit = Number(evaluation?.exit ?? evaluation?.status);
  let diagnosticResult = null;
  let diagnosticFailureResult = null;
  if (Number.isFinite(evaluatorExit) && evaluatorExit !== 0) {
    onLifecycle('diagnostic', 'started');
    try {
      diagnosticResult = diagnostics();
      if (Number(diagnosticResult?.exit ?? diagnosticResult?.status) !== 0)
        diagnosticFailureResult = diagnosticFailure('diagnostics', {
          raw_exit: diagnosticResult?.exit ?? diagnosticResult?.status,
          sanitized_stderr_tail: diagnosticResult?.sanitized_tail,
        });
    } catch (error) {
      diagnosticFailureResult = diagnosticFailure('diagnostics', error);
    }
    onLifecycle('diagnostic', 'completed');
  }
  onLifecycle('cleanup', 'started');
  let cleanupResult = null;
  let cleanupError = null;
  try {
    cleanupResult = cleanup();
  } catch (error) {
    cleanupError = error;
  }
  onLifecycle('cleanup', 'completed');
  if (evaluatorError) {
    evaluatorError.evaluator_exit = evaluatorExit;
    evaluatorError.exit = evaluatorExit;
    evaluatorError.diagnostic_failure = diagnosticFailureResult;
    evaluatorError.cleanup_result = cleanupResult;
    evaluatorError.cleanup_error = cleanupError;
    throw evaluatorError;
  }
  if (evaluatorExit !== 0) {
    const error = new Error(`evaluator_failed:${evaluatorExit}`);
    error.evaluator_exit = evaluatorExit;
    error.exit = evaluatorExit;
    error.evaluation = evaluation;
    error.diagnostic_result = diagnosticResult;
    error.diagnostic_failure = diagnosticFailureResult;
    error.cleanup_result = cleanupResult;
    error.cleanup_error = cleanupError;
    throw error;
  }
  if (cleanupError) throw cleanupError;
  return { evaluation, diagnosticResult, cleanupResult };
}

export function collectComposeFailureDiagnostics({
  run,
  composeCommand,
  project,
  artifactRoot,
  services = [],
}) {
  const secondaryFailures = [];
  const attempt = (identity, callback) => {
    try {
      return callback();
    } catch (error) {
      secondaryFailures.push(diagnosticFailure(identity, error));
      return null;
    }
  };

  const ps = attempt('diagnostic-compose-ps-all', () =>
    run('docker', [...composeCommand, 'ps', '--all', '--format', 'json'], {
      identity: 'diagnostic-compose-ps-all',
      captureStdout: (stdout) =>
        `${JSON.stringify(safePsProjection(stdout), null, 2)}\n`,
    }),
  );
  const allLogs = attempt('diagnostic-compose-logs-all', () =>
    run('docker', [...composeCommand, 'logs', '--no-color', '--timestamps'], {
      identity: 'diagnostic-compose-logs-all',
    }),
  );
  const serviceList = [
    ...new Set([
      ...services,
      ...safeServiceList(
        attempt('diagnostic-compose-services', () =>
          run('docker', [...composeCommand, 'config', '--services'], {
            identity: 'diagnostic-compose-services',
            captureStdout: (stdout) =>
              `${safeServiceList(stdout).join('\n')}\n`,
          }),
        )?.stdout,
      ),
      ...((ps?.stdout && safePsProjection(ps.stdout)) || [])
        .map((item) => item.service_name)
        .filter((name) => name && name !== 'unknown'),
    ]),
  ]
    .map((name) => safeName(name, 'unknown'))
    .filter((name) => name !== 'unknown')
    .sort();
  const serviceLogs = {};
  const logRoot = resolve(artifactRoot, 'service-logs');
  mkdirSync(logRoot, { recursive: true, mode: 0o700 });
  for (const service of serviceList) {
    const identity = `diagnostic-service-logs-${service}`;
    const value = attempt(identity, () =>
      run(
        'docker',
        [...composeCommand, 'logs', '--no-color', '--timestamps', service],
        {
          identity,
          captureStdout: (stdout) => redactDiagnosticText(stdout),
        },
      ),
    );
    if (!value) continue;
    const stdout = redactDiagnosticText(value.stdout ?? '').slice(
      0,
      MAX_LOG_BYTES,
    );
    const stderr = redactDiagnosticText(value.stderr ?? '').slice(
      0,
      MAX_LOG_BYTES,
    );
    const stdoutPath = resolve(logRoot, `${service}.stdout.log`);
    const stderrPath = resolve(logRoot, `${service}.stderr.log`);
    writeDiagnosticFile(stdoutPath, stdout);
    writeDiagnosticFile(stderrPath, stderr);
    serviceLogs[service] = {
      stdout_path: relative(artifactRoot, stdoutPath),
      stderr_path: relative(artifactRoot, stderrPath),
      stdout_tail: boundedTail(stdout),
      stderr_tail: boundedTail(stderr),
    };
  }
  const containers = attempt('diagnostic-project-containers', () =>
    run(
      'docker',
      ['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`],
      { identity: 'diagnostic-project-containers' },
    ),
  );
  const containerIds = (containers?.stdout ?? '')
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean);
  for (const [index, containerId] of containerIds.entries()) {
    attempt(`diagnostic-container-state-${index + 1}`, () =>
      run('docker', ['inspect', containerId], {
        identity: `diagnostic-container-state-${index + 1}`,
        captureStdout: (stdout) =>
          `${JSON.stringify(safeContainerStateProjection(JSON.parse(stdout)[0]), null, 2)}\n`,
      }),
    );
  }
  const record = {
    schema: 'agent-server.foundation.phase-c-compose-diagnostics',
    version: 2,
    project,
    all_services_requested: true,
    project_container_count: containerIds.length,
    secondary_failures: secondaryFailures,
    ps_state: safePsProjection(ps?.stdout ?? ''),
    services: serviceList,
    service_logs: serviceLogs,
    pool_error_control: poolErrorControlRecord(
      [
        serviceLogs['agent-server']?.stdout_tail,
        serviceLogs['agent-server']?.stderr_tail,
      ]
        .filter(Boolean)
        .join('\n'),
    ),
    all_logs_tail: boundedTail(
      `${allLogs?.stdout ?? ''}\n${allLogs?.stderr ?? ''}`,
    ),
  };
  const poolErrorPath = resolve(
    artifactRoot,
    'agent-server-pool-error-control.json',
  );
  writeDiagnosticFile(
    poolErrorPath,
    `${JSON.stringify(record.pool_error_control, null, 2)}\n`,
  );
  record.pool_error_control_path = relative(artifactRoot, poolErrorPath);
  writeDiagnosticFile(
    resolve(artifactRoot, 'diagnostic-collection.json'),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  return record;
}
