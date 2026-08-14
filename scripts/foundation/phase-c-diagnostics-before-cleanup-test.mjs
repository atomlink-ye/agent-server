import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { executeEvaluatorWithDiagnosticsBeforeCleanup } from './lib/phase-c-compose-diagnostics.mjs';
import { collectComposeFailureDiagnostics } from './lib/phase-c-compose-diagnostics.mjs';

const lifecycle = [];
const artifactRoot = mkdtempSync(join(tmpdir(), 'phase-c-before-cleanup-'));
let diagnosticCalls = 0;
let cleanupCalls = 0;
const diagnosticServices = [];
const fixtureInspect = {
  Name: '/phasec_fixture-agent-server-1',
  Config: {
    Labels: { 'com.docker.compose.service': 'agent-server' },
    Env: ['OPENCODE_GO_API_KEY=fixture-secret'],
    Cmd: ['forbidden-command'],
  },
  Mounts: [{ Source: '/forbidden', Destination: '/runtime-state', RW: false }],
  State: {
    Status: 'exited',
    Running: false,
    Restarting: true,
    OOMKilled: false,
    ExitCode: 1,
    StartedAt: '2026-08-14T00:00:00Z',
    FinishedAt: '2026-08-14T00:00:01Z',
    Health: {
      Status: 'unhealthy',
      Log: [{ Output: 'Bearer fixture-secret', ExitCode: 1 }],
    },
  },
};

function diagnosticRun(_command, args, options = {}) {
  const identity = options.identity;
  if (identity === 'diagnostic-compose-ps-all')
    return {
      stdout:
        '{"Service":"postgres","Name":"fixture-postgres-1","State":"running","Health":"healthy","ExitCode":0}\n{"Service":"agent-server","Name":"fixture-agent-server-1","State":"exited","Health":"unhealthy","ExitCode":1}\n',
      stderr: '',
      status: 0,
    };
  if (identity === 'diagnostic-compose-services')
    return { stdout: 'postgres\nagent-server\n', stderr: '', status: 0 };
  if (identity === 'diagnostic-project-containers')
    return { stdout: 'container-a\n', stderr: '', status: 0 };
  if (identity?.startsWith('diagnostic-service-logs-')) {
    const service = identity.slice('diagnostic-service-logs-'.length);
    return {
      stdout:
        service === 'agent-server'
          ? '2026-08-14T00:00:00Z pool error token=fixture-secret\n2026-08-14T00:00:01Z pool error token=fixture-secret\n'
          : `2026-08-14T00:00:00Z ${service} ready\n`,
      stderr: 'Bearer fixture-secret\n',
      status: 0,
    };
  }
  if (identity?.startsWith('diagnostic-container-state-'))
    return { stdout: JSON.stringify([fixtureInspect]), stderr: '', status: 0 };
  return { stdout: '', stderr: '', status: 0 };
}

try {
  assert.throws(
    () =>
      executeEvaluatorWithDiagnosticsBeforeCleanup({
        evaluator: () => ({
          exit: 17,
          status: 'FAIL',
          services: ['postgres', 'agent-server'],
        }),
        diagnostics: () => {
          diagnosticCalls += 1;
          const record = collectComposeFailureDiagnostics({
            run: diagnosticRun,
            composeCommand: ['compose', '-p', 'phasec_fixture'],
            project: 'phasec_fixture',
            artifactRoot,
            services: ['postgres', 'agent-server'],
          });
          diagnosticServices.push(...record.services);
          throw Object.assign(
            new Error('diagnostic_failed token=fixture-secret'),
            {
              raw_exit: 19,
              sanitized_stderr_tail: 'pool-error-control token=[REDACTED]',
            },
          );
        },
        cleanup: () => {
          cleanupCalls += 1;
          return { exit: 0 };
        },
        onLifecycle: (phase, state) => lifecycle.push(`${phase} ${state}`),
      }),
    (error) => {
      assert.equal(error.evaluator_exit, 17);
      assert.equal(error.exit, 17);
      assert.equal(error.diagnostic_failure.exit, 19);
      assert.equal(error.diagnostic_failure.status, 'MISSING_EVIDENCE');
      assert.match(error.diagnostic_failure.sanitized_tail, /\[REDACTED\]/u);
      return true;
    },
  );

  assert.deepEqual(lifecycle, [
    'diagnostic started',
    'diagnostic completed',
    'cleanup started',
    'cleanup completed',
  ]);
  assert.equal(diagnosticCalls, 1);
  assert.equal(cleanupCalls, 1);
  assert.deepEqual(diagnosticServices, ['agent-server', 'postgres']);
  const collection = JSON.parse(
    readFileSync(join(artifactRoot, 'diagnostic-collection.json'), 'utf8'),
  );
  assert.equal(collection.pool_error_control.count, 2);
  assert.match(collection.pool_error_control.log_segment, /\[REDACTED\]/u);
  assert.ok(collection.service_logs.postgres.stdout_tail);
  assert.ok(collection.service_logs['agent-server'].stderr_tail);
  assert.doesNotMatch(
    readFileSync(
      join(artifactRoot, collection.service_logs['agent-server'].stdout_path),
      'utf8',
    ),
    /fixture-secret/u,
  );
  assert.equal(
    statSync(join(artifactRoot, collection.service_logs.postgres.stdout_path))
      .mode & 0o777,
    0o600,
  );

  process.stdout.write(
    `${JSON.stringify({
      status: 'PASS',
      evaluator_exit_preserved: 17,
      diagnostic_exit_recorded: 19,
      diagnostics_before_cleanup: true,
      cleanup_completed: true,
      all_services_executed: true,
      redaction: true,
    })}\n`,
  );
} finally {
  rmSync(artifactRoot, { recursive: true, force: true });
}
