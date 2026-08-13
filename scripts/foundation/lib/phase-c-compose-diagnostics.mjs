import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MAX_HEALTH_LOGS = 20;
const MAX_HEALTH_OUTPUT_BYTES = 4096;

function boundedOutput(value) {
  return Buffer.from(String(value ?? ''))
    .subarray(-MAX_HEALTH_OUTPUT_BYTES)
    .toString('utf8');
}

export function safeContainerStateProjection(rawInspect) {
  const value =
    typeof rawInspect === 'string' ? JSON.parse(rawInspect) : rawInspect;
  const state = value.State ?? {};
  const health = state.Health ?? null;
  return {
    container_name: String(value.Name ?? '').replace(/^\//u, ''),
    service_name: String(
      value.Config?.Labels?.['com.docker.compose.service'] ?? '',
    ),
    state: {
      Status: state.Status ?? null,
      Running: state.Running === true,
      Paused: state.Paused === true,
      Restarting: state.Restarting === true,
      OOMKilled: state.OOMKilled === true,
      Dead: state.Dead === true,
      ExitCode: Number.isInteger(state.ExitCode) ? state.ExitCode : null,
      Error: String(state.Error ?? ''),
      StartedAt: state.StartedAt ?? null,
      FinishedAt: state.FinishedAt ?? null,
      Health: health
        ? {
            Status: health.Status ?? null,
            Log: (health.Log ?? []).slice(-MAX_HEALTH_LOGS).map((entry) => ({
              Output: boundedOutput(entry.Output),
              ExitCode: Number.isInteger(entry.ExitCode)
                ? entry.ExitCode
                : null,
              Start: entry.Start ?? null,
              End: entry.End ?? null,
            })),
          }
        : null,
    },
  };
}

export function collectComposeFailureDiagnostics({
  run,
  composeCommand,
  project,
  artifactRoot,
}) {
  const secondaryFailures = [];
  const attempt = (identity, callback) => {
    try {
      return callback();
    } catch (error) {
      secondaryFailures.push({
        command_identity: identity,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  };

  attempt('diagnostic-compose-ps-all', () =>
    run('docker', [...composeCommand, 'ps', '--all'], {
      identity: 'diagnostic-compose-ps-all',
    }),
  );
  attempt('diagnostic-compose-logs-all', () =>
    run('docker', [...composeCommand, 'logs', '--no-color', '--timestamps'], {
      identity: 'diagnostic-compose-logs-all',
    }),
  );
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
    version: 1,
    project,
    all_services_requested: true,
    project_container_count: containerIds.length,
    secondary_failures: secondaryFailures,
  };
  writeFileSync(
    resolve(artifactRoot, 'diagnostic-collection.json'),
    `${JSON.stringify(record, null, 2)}\n`,
    { mode: 0o600 },
  );
  return record;
}
