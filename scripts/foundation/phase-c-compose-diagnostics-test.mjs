import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  collectComposeFailureDiagnostics,
  safeContainerStateProjection,
} from './lib/phase-c-compose-diagnostics.mjs';

const artifactRoot = mkdtempSync(join(tmpdir(), 'phase-c-diagnostics-'));
const calls = [];
const fixture = {
  Id: 'forbidden-id',
  Name: '/phasec_fixture-paseo-runtime-1',
  Config: {
    Env: ['OPENCODE_GO_API_KEY=forbidden'],
    Cmd: ['forbidden-command'],
    Labels: {
      'com.docker.compose.service': 'paseo-runtime',
      secret: 'forbidden-label',
    },
  },
  Mounts: [{ Source: '/forbidden', Destination: '/forbidden' }],
  State: {
    Status: 'exited',
    Running: false,
    Paused: false,
    Restarting: false,
    OOMKilled: false,
    Dead: false,
    Pid: 1234,
    ExitCode: 1,
    Error: 'token=fixture-secret',
    StartedAt: '2026-08-13T00:00:00Z',
    FinishedAt: '2026-08-13T00:00:01Z',
    Health: {
      Status: 'unhealthy',
      FailingStreak: 99,
      Log: [
        {
          Output: `Bearer fixture-secret ${'x'.repeat(5000)}`,
          ExitCode: 1,
          Start: 'start',
          End: 'end',
        },
      ],
    },
  },
};

try {
  const run = (command, args, options = {}) => {
    calls.push({ command, args, identity: options.identity });
    if (options.identity === 'diagnostic-project-containers')
      return { stdout: 'container-a\ncontainer-b\n' };
    if (options.identity?.startsWith('diagnostic-container-state-')) {
      const raw = JSON.stringify([fixture]);
      return {
        stdout: raw,
        persisted: options.captureStdout(raw),
      };
    }
    return { stdout: '', stderr: '', status: 0 };
  };
  const record = collectComposeFailureDiagnostics({
    run,
    composeCommand: ['compose', '-p', 'phasec_fixture', '-f', 'compose.yaml'],
    project: 'phasec_fixture',
    artifactRoot,
  });
  const ps = calls.find(
    (call) => call.identity === 'diagnostic-compose-ps-all',
  );
  const logs = calls.find(
    (call) => call.identity === 'diagnostic-compose-logs-all',
  );
  if (!ps?.args.includes('--all')) throw new Error('ps did not request all');
  if (
    logs?.args.at(-3) !== 'logs' ||
    logs.args.at(-2) !== '--no-color' ||
    logs.args.at(-1) !== '--timestamps'
  )
    throw new Error('logs did not request all services');
  if (
    calls.filter((call) =>
      call.identity?.startsWith('diagnostic-container-state-'),
    ).length !== 2
  )
    throw new Error('not every project container was inspected');
  const projection = safeContainerStateProjection(fixture);
  const serialized = JSON.stringify(projection);
  for (const forbidden of [
    'Id',
    'Env',
    'Cmd',
    'Mounts',
    'Pid',
    'FailingStreak',
  ])
    if (serialized.includes(`"${forbidden}"`))
      throw new Error(`unsafe projection field: ${forbidden}`);
  if (projection.state.health.log[0].output.length > 4096)
    throw new Error('health output was not bounded');
  if (
    projection.mounts[0].destination !== '/forbidden' ||
    projection.mounts[0].read_only !== false ||
    serialized.includes('source')
  )
    throw new Error('mount projection was not sanitized');
  if (
    record.all_services_requested !== true ||
    record.project_container_count !== 2
  )
    throw new Error('diagnostic record lost all-service scope');
  JSON.parse(
    readFileSync(join(artifactRoot, 'diagnostic-collection.json'), 'utf8'),
  );
  process.stdout.write(
    `${JSON.stringify({ status: 'PASS', all_services: true, project_containers: 2, safe_allowlist: true, health_output_bounded: true })}\n`,
  );
} finally {
  rmSync(artifactRoot, { recursive: true, force: true });
}
