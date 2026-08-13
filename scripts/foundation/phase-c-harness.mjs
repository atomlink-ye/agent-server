import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { arch } from 'node:os';

import { deriveComposeVolumeEnvironment } from '../dev/compose-volume-environment.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const project = process.env.COMPOSE_PROJECT_NAME;
if (!project || !/^phasec_[a-z0-9_-]+$/u.test(project))
  throw new Error('COMPOSE_PROJECT_NAME must be a unique phasec_* name');
if (!process.env.OPENCODE_GO_API_KEY?.trim())
  throw new Error('OPENCODE_GO_API_KEY is required');
const artifactRoot = resolve(
  process.env.FOUNDATION_PHASE_C_OUTPUT ?? `.local/phase-c/${project}`,
);
mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
const composeFiles = [
  '-f',
  'compose.yaml',
  '-f',
  'compose.runtime.yaml',
  '-f',
  'compose.external-runtime.yaml',
];
const wrapper = resolve(ROOT, 'scripts/dev/docker-compose');
const rawCompose = ['compose', '-p', project, ...composeFiles];
const scannedTranscripts = [];
const composeEnvironment = {
  ...process.env,
  ...(await deriveComposeVolumeEnvironment({
    root: ROOT,
    architecture: arch(),
    nodeAbi: process.env.AGENT_SERVER_NODE_ABI ?? '137',
  })),
};
const candidateSha = spawnSync(
  'git',
  ['-C', ROOT, 'rev-parse', 'HEAD'],
  { encoding: 'utf8' },
).stdout.trim();
if (!/^[0-9a-f]{40}$/u.test(candidateSha))
  throw new Error('candidate_sha_missing');

function run(command, args, { allow = [0], env = composeEnvironment } = {}) {
  const value = spawnSync(command, args, {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (!allow.includes(value.status))
    throw new Error(`child_command_failed:status=${value.status ?? 'spawn_error'}`);
  scannedTranscripts.push(value.stdout, value.stderr);
  return value;
}

function sanitizeService(name, service) {
  return {
    name,
    command: Array.isArray(service.command)
      ? service.command.map(String)
      : [String(service.command ?? '')].filter(Boolean),
    depends_on: Object.keys(service.depends_on ?? {}).sort(),
    environment: Object.fromEntries(
      Object.keys(service.environment ?? {})
        .sort()
        .map((key) => [
          key,
          key === 'PASEO_WS_URL' ? service.environment[key] : true,
        ]),
    ),
    mounts: (service.volumes ?? []).map((volume) => ({
      source: typeof volume === 'string' ? volume.split(':')[0] : volume.source,
      target: typeof volume === 'string' ? volume.split(':')[1] : volume.target,
    })),
  };
}

function containerRecord(service, composeCommand = rawCompose) {
  const id = run('docker', [
    ...composeCommand,
    'ps',
    '-q',
    service,
  ]).stdout.trim();
  if (!id) throw new Error(`container_missing:${service}`);
  const inspect = JSON.parse(
    run('docker', [
      'inspect',
      '--format',
      '{{json .Mounts}}',
      id,
    ]).stdout,
  );
  const environmentNames = run('docker', [
    'inspect',
    '--format',
    '{{range .Config.Env}}{{println (index (split . "=") 0)}}{{end}}',
    id,
  ]).stdout
    .split(/\r?\n/u)
    .map((name) => name.trim())
    .filter(Boolean)
    .sort();
  const top = run('docker', [
    ...composeCommand,
    'top',
    service,
    '-eo',
    'comm=',
  ]).stdout
    .split(/\r?\n/u)
    .map((command) => command.trim())
    .filter(Boolean)
    .map((command) => ({ command }));
  return {
    container_id: id,
    environment_names: environmentNames,
    processes: top,
    mounts: inspect.map((mount) => ({
      type: mount.Type,
      source_name: mount.Name || null,
      destination: mount.Destination,
      read_only: mount.RW === false,
    })),
  };
}

let cleanupComplete = false;
function cleanup() {
  const projectNetworksBefore = run('docker', [
    'network',
    'ls',
    '--filter',
    `label=com.docker.compose.project=${project}`,
    '--format',
    '{{.Name}}',
  ]).stdout.trim().split(/\r?\n/u).filter(Boolean).sort();
  const projectVolumesBefore = run('docker', [
    'volume',
    'ls',
    '--filter',
    `label=com.docker.compose.project=${project}`,
    '--format',
    '{{.Name}}',
  ]).stdout.trim().split(/\r?\n/u).filter(Boolean).sort();
  const providerBefore = run('docker', [
    'volume',
    'inspect',
    composeEnvironment.PROVIDER_TOOLCHAIN_VOLUME,
    '--format',
    '{{.Name}}',
  ]).stdout.trim();
  const cleanupResult = run(
    'docker',
    [...rawCompose, 'down', '--remove-orphans', '--volumes'],
    { allow: [0, 1] },
  );
  const remaining = run('docker', [...rawCompose, 'ps', '-aq'], {
    allow: [0],
  }).stdout.trim();
  const remainingNetworks = run('docker', [
    'network',
    'ls',
    '--filter',
    `label=com.docker.compose.project=${project}`,
    '--format',
    '{{.Name}}',
  ]).stdout.trim().split(/\r?\n/u).filter(Boolean);
  const remainingVolumes = run('docker', [
    'volume',
    'ls',
    '--filter',
    `label=com.docker.compose.project=${project}`,
    '--format',
    '{{.Name}}',
  ]).stdout.trim().split(/\r?\n/u).filter(Boolean);
  const providerAfter = run('docker', [
    'volume',
    'inspect',
    composeEnvironment.PROVIDER_TOOLCHAIN_VOLUME,
    '--format',
    '{{.Name}}',
  ]).stdout.trim();
  if (remaining) throw new Error(`cleanup_incomplete:${remaining}`);
  if (remainingNetworks.length || remainingVolumes.length)
    throw new Error('cleanup_project_resources_incomplete');
  if (providerBefore !== providerAfter)
    throw new Error('cleanup_external_provider_volume_changed');
  if (cleanupResult.status !== 0)
    throw new Error(`cleanup_failed:${cleanupResult.status}`);
  cleanupComplete = true;
  return {
    project,
    candidate_sha: candidateSha,
    down_exit: cleanupResult.status,
    remaining_project_containers: [],
    project_networks_before: projectNetworksBefore,
    remaining_project_networks: remainingNetworks,
    project_volumes_before: projectVolumesBefore,
    remaining_project_volumes: remainingVolumes,
    external_provider_volume_before: providerBefore,
    external_provider_volume_after: providerAfter,
  };
}
try {
  // Effective Compose JSON exists only in this process's memory. Credential
  // values are discarded before any artifact is written.
  const effective = JSON.parse(
    run(
      wrapper,
      [...composeFiles, '-p', project, 'config', '--format', 'json'],
      {
        env: {
          ...composeEnvironment,
          OPENCODE_GO_API_KEY: '__PHASE_C_CONFIG_REDACTED__',
        },
      },
    ).stdout,
  );
  const sanitizedCompose = Object.entries(effective.services ?? {})
    .map(([name, service]) => sanitizeService(name, service))
    .sort((left, right) => left.name.localeCompare(right.name));

  run(wrapper, [
    ...composeFiles,
    '-p',
    project,
    'up',
    '--build',
    '-d',
    '--wait',
    'postgres',
    'provider-toolchain-init',
    'paseo-runtime',
    'agent-server',
  ]);
  const runtimeRecord = {
    schema: 'agent-server.foundation.phase-c-runtime-record',
    version: 1,
    project,
    captured_at: new Date().toISOString(),
    effective_compose: { services: sanitizedCompose },
    runtime_inspection: {
      containers: ['agent-server', 'paseo-runtime'],
      agent_server: containerRecord('agent-server'),
      paseo_runtime: containerRecord('paseo-runtime'),
    },
  };
  const runtimePath = resolve(artifactRoot, 'runtime-record.json');
  writeFileSync(runtimePath, `${JSON.stringify(runtimeRecord, null, 2)}\n`, {
    mode: 0o600,
  });
  const topology = run(process.execPath, [
    'scripts/foundation/phase-c.mjs',
    'E4',
    '--runtime-record',
    runtimePath,
  ]);
  const mutationProject = `${project}_e4red`;
  const mutationFiles = [
    ...composeFiles,
    '-f',
    'scripts/foundation/phase-c-e4-ownership-mutation.yaml',
  ];
  const mutationCompose = ['compose', '-p', mutationProject, ...mutationFiles];
  let mutation;
  try {
    const mutationEffective = JSON.parse(
      run(
        wrapper,
        [...mutationFiles, '-p', mutationProject, 'config', '--format', 'json'],
        {
          env: {
            ...composeEnvironment,
            OPENCODE_GO_API_KEY: '__PHASE_C_CONFIG_REDACTED__',
          },
        },
      ).stdout,
    );
    run(wrapper, [
      ...mutationFiles,
      '-p',
      mutationProject,
      'up',
      '-d',
      '--wait',
      'postgres',
      'provider-toolchain-init',
      'paseo-runtime',
      'agent-server',
    ]);
    const mutationRecordPath = resolve(artifactRoot, 'e4-mutation-record.json');
    const mutationRecord = {
      schema: 'agent-server.foundation.phase-c-runtime-record',
      version: 1,
      project: mutationProject,
      candidate_sha: candidateSha,
      mutation: {
        name: 'restore-agent-provider-ownership',
        source: 'scripts/foundation/phase-c-e4-ownership-mutation.yaml',
      },
      effective_compose: {
        services: Object.entries(mutationEffective.services ?? {})
          .map(([name, service]) => sanitizeService(name, service))
          .sort((left, right) => left.name.localeCompare(right.name)),
      },
      runtime_inspection: {
        containers: ['agent-server', 'paseo-runtime'],
        agent_server: containerRecord('agent-server', mutationCompose),
        paseo_runtime: containerRecord('paseo-runtime', mutationCompose),
      },
    };
    writeFileSync(
      mutationRecordPath,
      `${JSON.stringify(mutationRecord, null, 2)}\n`,
      { mode: 0o600 },
    );
    const mutationRun = run(
      process.execPath,
      [
        'scripts/foundation/phase-c.mjs',
        'E4',
        '--runtime-record',
        mutationRecordPath,
      ],
      { allow: [1] },
    );
    const mutationResult = JSON.parse(mutationRun.stdout.trim().split('\n').at(-1));
    if (mutationRun.status !== 1 || mutationResult.status !== 'FAIL')
      throw new Error('e4_ownership_mutation_not_red');
    mutation = {
      name: 'restore-agent-provider-ownership',
      exit: mutationRun.status,
      status: mutationResult.status,
    };
  } finally {
    run('docker', [...mutationCompose, 'down', '--remove-orphans', '--volumes'], {
      allow: [0, 1],
    });
  }

  const proofPath = resolve(artifactRoot, 'proof-record.json');
  const runEnvironment = {
    ...process.env,
    FOUNDATION_PROOF_RECORD: proofPath,
    AGENT_SERVER_BASE_URL: 'http://127.0.0.1:3000',
    AGENT_SERVER_SERVICE_TOKEN: 'token-local-dev',
  };
  const negative = run(
    process.execPath,
    ['scripts/foundation/phase-c-real-run.mjs', '--negative-control'],
    { allow: [1], env: runEnvironment },
  );
  const negativeResult = JSON.parse(negative.stdout.trim().split('\n').at(-1));
  if (negative.status !== 1 || negativeResult.status !== 'FAIL')
    throw new Error('negative_control_not_red');
  run(process.execPath, ['scripts/foundation/phase-c-real-run.mjs'], {
    env: runEnvironment,
  });
  const proof = JSON.parse(readFileSync(proofPath, 'utf8'));
  proof.negative_control = {
    kind: 'nonexistent_definition',
    exit: negative.status,
    status: negativeResult.status,
    reason: negativeResult.reason,
    http_status: negativeResult.http_status,
    error_code: negativeResult.error_code,
    error_message: negativeResult.error_message,
    request_id_present: negativeResult.request_id_present,
    missing: false,
  };
  proof.candidate_sha = candidateSha;
  proof.agent_server_container_id = runtimeRecord.runtime_inspection.agent_server.container_id;
  proof.paseo_runtime_container_id = runtimeRecord.runtime_inspection.paseo_runtime.container_id;
  proof.runtime_record = 'runtime-record.json';
  proof.e4_mutation = mutation;
  proof.cleanup = cleanup();
  const serialized = [runtimePath, proofPath]
    .map((path) => (path === proofPath ? JSON.stringify(proof) : readFileSync(path, 'utf8')))
    .join('\n');
  const secretHits = [...scannedTranscripts, serialized].filter((value) =>
    value.includes(process.env.OPENCODE_GO_API_KEY),
  ).length;
  if (secretHits !== 0)
    throw new Error('secret_scan_failed');
  proof.secret_hits = secretHits;
  writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`, {
    mode: 0o600,
  });
  process.stdout.write(
    `${JSON.stringify({ status: 'PASS', runtime_record: runtimePath, proof_record: proofPath, topology: JSON.parse(topology.stdout) })}\n`,
  );
} finally {
  if (!cleanupComplete) cleanup();
}
