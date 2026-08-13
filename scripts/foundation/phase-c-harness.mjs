import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { arch } from 'node:os';

import { deriveComposeVolumeEnvironment } from '../dev/compose-volume-environment.mjs';
import {
  createCommandRunner,
  secretValuesFromEnvironment,
} from './lib/phase-c-command-capture.mjs';
import { collectComposeFailureDiagnostics } from './lib/phase-c-compose-diagnostics.mjs';
import {
  workspaceIsReadOnly,
  workspaceIsWritable,
} from './lib/phase-c-workspace-boundary.mjs';
import {
  runtimeIsNonroot,
  runtimeStateIsReadOnly,
  runtimeStateIsWritable,
} from './lib/phase-c-runtime-boundary.mjs';
import {
  collectServiceProcesses,
  isPaseoExecutableProcess,
  isPaseoProcess,
} from './lib/phase-c-process-inspection.mjs';
import { runtimeBoundaryCleanupProbes } from './lib/phase-c-runtime-cleanup.mjs';
import { executeStandaloneMutation } from './lib/phase-c-standalone-mutation.mjs';

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
const capturedArtifactPaths = [];
const composeEnvironment = {
  ...process.env,
  ...(await deriveComposeVolumeEnvironment({
    root: ROOT,
    architecture: arch(),
    nodeAbi: process.env.AGENT_SERVER_NODE_ABI ?? '137',
    includeProvider: true,
  })),
};
const candidateSha = process.env.FOUNDATION_CANDIDATE_SHA?.trim() ?? '';
if (!/^[0-9a-f]{40}$/u.test(candidateSha))
  throw new Error('FOUNDATION_CANDIDATE_SHA must be an exact 40-hex Git SHA');
const run = createCommandRunner({
  root: ROOT,
  artifactRoot,
  defaultEnvironment: composeEnvironment,
  secretValues: [
    ...secretValuesFromEnvironment(composeEnvironment),
    'token-local-dev',
    'token-local-dev-2',
  ],
  transcriptSink: scannedTranscripts,
  artifactSink: capturedArtifactPaths,
});

const standaloneMutationMode =
  process.env.FOUNDATION_PHASE_C_MODE === 'missing-paseo-process';

function runCriticalCompose(
  command,
  args,
  options,
  composeCommand,
  runProject,
) {
  try {
    return run(command, args, options);
  } catch (firstFailure) {
    try {
      collectComposeFailureDiagnostics({
        run,
        composeCommand,
        project: runProject,
        artifactRoot,
      });
    } catch {
      // Diagnostic collection is secondary; preserve the original failure.
    }
    throw firstFailure;
  }
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
  const processInspection = collectServiceProcesses({
    run,
    composeCommand,
    service,
    identity: `${service}-inspection`,
  });
  const id = processInspection.containerId;
  const inspect = JSON.parse(
    run('docker', ['inspect', '--format', '{{json .Mounts}}', id]).stdout,
  );
  const environmentNames = run('docker', [
    'inspect',
    '--format',
    '{{range .Config.Env}}{{println (index (split . "=") 0)}}{{end}}',
    id,
  ])
    .stdout.split(/\r?\n/u)
    .map((name) => name.trim())
    .filter(Boolean)
    .sort();
  return {
    container_id: id,
    environment_names: environmentNames,
    processes: processInspection.processes,
    mounts: inspect.map((mount) => ({
      type: mount.Type,
      source_name: mount.Name || null,
      destination: mount.Destination,
      read_only: mount.RW === false,
    })),
  };
}

function workspaceProbePath(probeProject) {
  return `/workspace/.phase-c-write-probe-${probeProject}`;
}

function workspaceProbeHostPath(probeProject) {
  return resolve(ROOT, `.phase-c-write-probe-${probeProject}`);
}

function workspaceWriteProbe(composeCommand, probeProject, identity) {
  const probePath = workspaceProbePath(probeProject);
  const script =
    "const fs=require('node:fs');const p=process.argv[1];let write_exit=0,error_code=null;try{fs.writeFileSync(p,'phase-c-probe',{flag:'wx'})}catch(e){write_exit=1;error_code=e?.code??'UNKNOWN'}const file_present=fs.existsSync(p);process.stdout.write(JSON.stringify({write_exit,error_code,file_present}))";
  const result = run(
    'docker',
    [
      ...composeCommand,
      'exec',
      '-T',
      'paseo-runtime',
      'node',
      '-e',
      script,
      probePath,
    ],
    { identity },
  );
  const observed = JSON.parse(result.stdout.trim());
  return {
    write_exit: observed.write_exit,
    error_code: observed.error_code,
    file_present: observed.file_present,
  };
}

function runtimeIdentity(composeCommand, identity) {
  const script =
    "const fs=require('node:fs');const s=fs.readFileSync('/proc/1/status','utf8');const n=k=>Number(s.match(new RegExp('^'+k+':\\\\s+(\\\\d+)','m'))?.[1]);process.stdout.write(JSON.stringify({process_uid:process.getuid(),process_gid:process.getgid(),pid1_uid:n('Uid'),pid1_gid:n('Gid')}))";
  const result = run(
    'docker',
    [...composeCommand, 'exec', '-T', 'paseo-runtime', 'node', '-e', script],
    { identity },
  );
  return JSON.parse(result.stdout.trim());
}

function runtimeStateProbe(composeCommand, probeProject, identity) {
  const probePath = `/runtime-state/.phase-c-state-probe-${probeProject}`;
  const script =
    "const fs=require('node:fs');const p=process.argv[1];let write_exit=0,error_code=null;try{fs.writeFileSync(p,'phase-c-state-probe',{flag:'wx'});fs.rmSync(p)}catch(e){write_exit=1;error_code=e?.code??'UNKNOWN'}const file_present=fs.existsSync(p);process.stdout.write(JSON.stringify({write_exit,error_code,file_present}))";
  const result = run(
    'docker',
    [
      ...composeCommand,
      'exec',
      '-T',
      'paseo-runtime',
      'node',
      '-e',
      script,
      probePath,
    ],
    { identity },
  );
  return JSON.parse(result.stdout.trim());
}

function removeWorkspaceProbe(composeCommand, probeProject, identity) {
  const script =
    "const fs=require('node:fs');const p=process.argv[1];fs.rmSync(p,{force:true});process.stdout.write(JSON.stringify({file_present:fs.existsSync(p)}))";
  const result = run(
    'docker',
    [
      ...composeCommand,
      'exec',
      '-T',
      'paseo-runtime',
      'node',
      '-e',
      script,
      workspaceProbePath(probeProject),
    ],
    { identity },
  );
  const observed = JSON.parse(result.stdout.trim());
  if (observed.file_present !== false)
    throw new Error('workspace_probe_cleanup_incomplete');
  return { file_present: false };
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
  ])
    .stdout.trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .sort();
  const projectVolumesBefore = run('docker', [
    'volume',
    'ls',
    '--filter',
    `label=com.docker.compose.project=${project}`,
    '--format',
    '{{.Name}}',
  ])
    .stdout.trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .sort();
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
  ])
    .stdout.trim()
    .split(/\r?\n/u)
    .filter(Boolean);
  const remainingVolumes = run('docker', [
    'volume',
    'ls',
    '--filter',
    `label=com.docker.compose.project=${project}`,
    '--format',
    '{{.Name}}',
  ])
    .stdout.trim()
    .split(/\r?\n/u)
    .filter(Boolean);
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

function runRuntimeBoundaryMutation({
  suffix,
  name,
  mutationSource,
  overlays,
  expectedFailure,
  instrumentation = null,
}) {
  const runProject = `${project}_${suffix}`;
  const files = [
    ...composeFiles,
    '-f',
    'scripts/foundation/phase-c-e4-no-ports.yaml',
  ];
  for (const overlay of overlays) files.push('-f', overlay);
  const composeCommand = ['compose', '-p', runProject, ...files];
  const providerBefore = run('docker', [
    'volume',
    'inspect',
    composeEnvironment.PROVIDER_TOOLCHAIN_VOLUME,
    '--format',
    '{{.Name}}',
  ]).stdout.trim();
  let record;
  let recordPath;
  let resultRecord;
  let cleanupRecord;
  let primaryError;
  let cleanupFailure;
  let diagnosticFailure;
  try {
    const effective = JSON.parse(
      run(wrapper, [...files, '-p', runProject, 'config', '--format', 'json'], {
        env: {
          ...composeEnvironment,
          OPENCODE_GO_API_KEY: '__PHASE_C_CONFIG_REDACTED__',
        },
        identity: `${suffix}-compose-effective-config`,
        captureStdout: false,
      }).stdout,
    );
    runCriticalCompose(
      wrapper,
      [
        ...files,
        '-p',
        runProject,
        'up',
        '-d',
        '--wait',
        'postgres',
        'provider-toolchain-init',
        'paseo-runtime-state-init',
        'paseo-runtime',
        'agent-server',
      ],
      { identity: `${suffix}-compose-up-wait` },
      composeCommand,
      runProject,
    );
    let childObservation;
    if (instrumentation === 'failed-runtime-child-carrier') {
      const childExit = Number(
        run(
          'docker',
          [
            ...composeCommand,
            'exec',
            '-T',
            'paseo-runtime',
            '/bin/sh',
            '-c',
            'cat /tmp/runtime-child.exit',
          ],
          { identity: `${suffix}-runtime-child-exit` },
        ).stdout.trim(),
      );
      childObservation = {
        instrumentation,
        real_runtime_child_exit: childExit,
        real_runtime_child_survived: collectServiceProcesses({
          run,
          composeCommand,
          service: 'paseo-runtime',
          identity: `${suffix}-runtime-child`,
        }).processes.some(isPaseoExecutableProcess),
      };
      if (childExit !== 1 || childObservation.real_runtime_child_survived)
        throw new Error(`${suffix}_runtime_child_observation_invalid`);
    }
    recordPath = resolve(artifactRoot, `${suffix}-runtime-record.json`);
    record = {
      schema: 'agent-server.foundation.phase-c-runtime-record',
      version: 1,
      project: runProject,
      candidate_sha: candidateSha,
      mutation: {
        name,
        source: mutationSource,
        operational_overlays: overlays.filter(
          (path) => path !== mutationSource,
        ),
        ...childObservation,
      },
      effective_compose: {
        services: Object.entries(effective.services ?? {})
          .map(([serviceName, service]) =>
            sanitizeService(serviceName, service),
          )
          .sort((left, right) => left.name.localeCompare(right.name)),
      },
      runtime_inspection: {
        containers: ['agent-server', 'paseo-runtime'],
        agent_server: containerRecord('agent-server', composeCommand),
        paseo_runtime: {
          ...containerRecord('paseo-runtime', composeCommand),
          identity: runtimeIdentity(
            composeCommand,
            `${suffix}-runtime-identity`,
          ),
          runtime_state_probe: runtimeStateProbe(
            composeCommand,
            runProject,
            `${suffix}-runtime-state-probe`,
          ),
          workspace_write_probe: workspaceWriteProbe(
            composeCommand,
            runProject,
            `${suffix}-workspace-probe`,
          ),
        },
      },
    };
    writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, {
      mode: 0o600,
    });
    const evaluation = run(
      process.execPath,
      ['scripts/foundation/phase-c.mjs', 'E4', '--runtime-record', recordPath],
      { allow: [1], identity: `${suffix}-e4-evaluator` },
    );
    const evaluated = JSON.parse(evaluation.stdout.trim().split('\n').at(-1));
    if (
      evaluation.status !== 1 ||
      evaluated.status !== 'FAIL' ||
      JSON.stringify(evaluated.failures) !== JSON.stringify([expectedFailure])
    )
      throw new Error(`${suffix}_mutation_not_exact_red`);
    resultRecord = {
      name,
      source: mutationSource,
      operational_overlays: overlays.filter((path) => path !== mutationSource),
      exit: evaluation.status,
      status: evaluated.status,
      failures: evaluated.failures,
      identity: record.runtime_inspection.paseo_runtime.identity,
      runtime_state_probe:
        record.runtime_inspection.paseo_runtime.runtime_state_probe,
      workspace_write_probe:
        record.runtime_inspection.paseo_runtime.workspace_write_probe,
      processes: record.runtime_inspection.paseo_runtime.processes,
      ...childObservation,
    };
  } catch (error) {
    primaryError = error;
  } finally {
    const cleanupErrors = [];
    const observe = (operation, fallback) => {
      try {
        return operation();
      } catch (error) {
        cleanupErrors.push(error);
        return fallback;
      }
    };
    try {
      const diagnosticRoot = resolve(artifactRoot, `diagnostics-${suffix}`);
      mkdirSync(diagnosticRoot, { recursive: true, mode: 0o700 });
      collectComposeFailureDiagnostics({
        run,
        composeCommand,
        project: runProject,
        artifactRoot: diagnosticRoot,
      });
    } catch (error) {
      // Preserve diagnostic failure as bounded secondary evidence.
      diagnosticFailure = error;
    }
    const down = observe(
      () =>
        run(
          'docker',
          [...composeCommand, 'down', '--remove-orphans', '--volumes'],
          { allow: [0] },
        ),
      { status: null },
    );
    const containers = observe(
      () =>
        run('docker', [...composeCommand, 'ps', '-aq'], {
          allow: [0],
        }).stdout.trim(),
      'cleanup-observation-failed',
    );
    const networks = observe(
      () =>
        run('docker', [
          'network',
          'ls',
          '--filter',
          `label=com.docker.compose.project=${runProject}`,
          '--format',
          '{{.Name}}',
        ])
          .stdout.trim()
          .split(/\r?\n/u)
          .filter(Boolean),
      ['cleanup-observation-failed'],
    );
    const volumes = observe(
      () =>
        run('docker', [
          'volume',
          'ls',
          '--filter',
          `label=com.docker.compose.project=${runProject}`,
          '--format',
          '{{.Name}}',
        ])
          .stdout.trim()
          .split(/\r?\n/u)
          .filter(Boolean),
      ['cleanup-observation-failed'],
    );
    const providerAfter = observe(
      () =>
        run('docker', [
          'volume',
          'inspect',
          composeEnvironment.PROVIDER_TOOLCHAIN_VOLUME,
          '--format',
          '{{.Name}}',
        ]).stdout.trim(),
      'cleanup-observation-failed',
    );
    let cleanupProbeRecord = {};
    try {
      cleanupProbeRecord = runtimeBoundaryCleanupProbes(resultRecord, record);
    } catch (error) {
      cleanupErrors.push(error);
      cleanupFailure = error;
    }
    if (!cleanupFailure && (containers || networks.length || volumes.length))
      cleanupFailure = new Error(`${suffix}_mutation_cleanup_incomplete`);
    else if (!cleanupFailure && providerBefore !== providerAfter)
      cleanupFailure = new Error(`${suffix}_mutation_provider_volume_changed`);
    else if (!cleanupFailure && cleanupErrors.length)
      cleanupFailure = new Error(`${suffix}_mutation_cleanup_command_failed`);
    cleanupRecord = {
      project: runProject,
      ...cleanupProbeRecord,
      down_exit: down.status,
      remaining_project_containers: [],
      remaining_project_networks: networks,
      remaining_project_volumes: volumes,
      external_provider_volume_before: providerBefore,
      external_provider_volume_after: providerAfter,
    };
    if (record && recordPath) {
      record.cleanup = cleanupRecord;
      writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, {
        mode: 0o600,
      });
    }
  }
  const mutationFailures = [
    primaryError
      ? {
          phase: 'primary',
          message: String(primaryError.message ?? primaryError),
        }
      : null,
    diagnosticFailure
      ? {
          phase: 'diagnostics',
          message: String(diagnosticFailure.message ?? diagnosticFailure),
        }
      : null,
    cleanupFailure
      ? {
          phase: 'cleanup',
          message: String(cleanupFailure.message ?? cleanupFailure),
        }
      : null,
  ].filter(Boolean);
  if (mutationFailures.length) {
    const firstFailure = primaryError ?? diagnosticFailure ?? cleanupFailure;
    const combined =
      firstFailure instanceof Error
        ? firstFailure
        : new Error(`${suffix}_mutation_failed`);
    combined.mutation_failures = mutationFailures;
    combined.primary_failure = mutationFailures[0];
    combined.cleanup_failure = cleanupFailure
      ? mutationFailures.find((failure) => failure.phase === 'cleanup')
      : null;
    throw combined;
  }
  return { result: resultRecord, cleanup: cleanupRecord, recordPath };
}

function runEnvironmentOwnershipMutation({
  suffix,
  name,
  mutationSource,
  projectionOverlay,
  launchOverlay,
  expectedFailures,
}) {
  const runProject = `${project}_${suffix}`;
  const cleanFiles = [
    ...composeFiles,
    '-f',
    'scripts/foundation/phase-c-e4-no-ports.yaml',
  ];
  const projectionFiles = projectionOverlay
    ? [...cleanFiles, '-f', projectionOverlay]
    : cleanFiles;
  const launchFiles = launchOverlay
    ? [...cleanFiles, '-f', launchOverlay]
    : cleanFiles;
  const projectionCompose = ['compose', '-p', runProject, ...projectionFiles];
  const launchCompose = ['compose', '-p', runProject, ...launchFiles];
  const providerBefore = run('docker', [
    'volume',
    'inspect',
    composeEnvironment.PROVIDER_TOOLCHAIN_VOLUME,
    '--format',
    '{{.Name}}',
  ]).stdout.trim();
  let record;
  let recordPath;
  let resultRecord;
  let cleanupRecord;
  let primaryError;
  let cleanupFailure;
  let diagnosticFailure;
  try {
    const effective = JSON.parse(
      run(
        wrapper,
        [...projectionFiles, '-p', runProject, 'config', '--format', 'json'],
        {
          env: {
            ...composeEnvironment,
            OPENCODE_GO_API_KEY: '__PHASE_C_CONFIG_REDACTED__',
          },
          identity: `${suffix}-compose-effective-config`,
          captureStdout: false,
        },
      ).stdout,
    );
    runCriticalCompose(
      wrapper,
      [
        ...launchFiles,
        '-p',
        runProject,
        'up',
        '-d',
        '--wait',
        'postgres',
        'provider-toolchain-init',
        'paseo-runtime-state-init',
        'paseo-runtime',
        'agent-server',
      ],
      { identity: `${suffix}-compose-up-wait` },
      launchCompose,
      runProject,
    );
    recordPath = resolve(artifactRoot, `${suffix}-runtime-record.json`);
    record = {
      schema: 'agent-server.foundation.phase-c-runtime-record',
      version: 1,
      project: runProject,
      candidate_sha: candidateSha,
      mutation: {
        name,
        source: mutationSource,
        projection_overlay: projectionOverlay,
        launch_overlay: launchOverlay,
        operational_overlays: ['scripts/foundation/phase-c-e4-no-ports.yaml'],
      },
      effective_compose: {
        services: Object.entries(effective.services ?? {})
          .map(([serviceName, service]) =>
            sanitizeService(serviceName, service),
          )
          .sort((left, right) => left.name.localeCompare(right.name)),
      },
      runtime_inspection: {
        containers: ['agent-server', 'paseo-runtime'],
        agent_server: containerRecord('agent-server', launchCompose),
        paseo_runtime: {
          ...containerRecord('paseo-runtime', launchCompose),
          identity: runtimeIdentity(
            launchCompose,
            `${suffix}-runtime-identity`,
          ),
          runtime_state_probe: runtimeStateProbe(
            launchCompose,
            runProject,
            `${suffix}-runtime-state-probe`,
          ),
          workspace_write_probe: workspaceWriteProbe(
            launchCompose,
            runProject,
            `${suffix}-workspace-probe`,
          ),
        },
      },
    };
    writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, {
      mode: 0o600,
    });
    const evaluation = run(
      process.execPath,
      ['scripts/foundation/phase-c.mjs', 'E4', '--runtime-record', recordPath],
      { allow: [1], identity: `${suffix}-e4-evaluator` },
    );
    const evaluated = JSON.parse(evaluation.stdout.trim().split('\n').at(-1));
    if (
      evaluation.status !== 1 ||
      evaluated.status !== 'FAIL' ||
      JSON.stringify(evaluated.failures) !== JSON.stringify(expectedFailures)
    )
      throw new Error(`${suffix}_mutation_not_exact_red`);
    const runtime = record.runtime_inspection.paseo_runtime;
    const agent = record.runtime_inspection.agent_server;
    const effectiveAgent = record.effective_compose.services.find(
      (service) => service.name === 'agent-server',
    );
    const declarativeProviderPresent =
      effectiveAgent?.environment?.PASEO_PROVIDER === true;
    const actualProviderPresent =
      agent.environment_names.includes('PASEO_PROVIDER');
    const nonTargetFactsGreen =
      runtimeIsNonroot(runtime.identity) &&
      runtimeStateIsWritable(runtime.runtime_state_probe) &&
      workspaceIsReadOnly(runtime.workspace_write_probe) &&
      runtime.processes.some(isPaseoExecutableProcess) &&
      !agent.processes.some(isPaseoProcess) &&
      runtime.environment_names.includes('PASEO_PROVIDER') &&
      (projectionOverlay
        ? declarativeProviderPresent
        : !declarativeProviderPresent) &&
      (launchOverlay ? actualProviderPresent : !actualProviderPresent);
    if (!nonTargetFactsGreen)
      throw new Error(`${suffix}_non_target_facts_not_green`);
    resultRecord = {
      name,
      source: mutationSource,
      projection_overlay: projectionOverlay,
      launch_overlay: launchOverlay,
      operational_overlays: ['scripts/foundation/phase-c-e4-no-ports.yaml'],
      exit: evaluation.status,
      status: evaluated.status,
      failures: evaluated.failures,
      non_target_facts_green: nonTargetFactsGreen,
      declarative_provider_present: declarativeProviderPresent,
      actual_provider_present: actualProviderPresent,
      identity: runtime.identity,
      runtime_state_probe: runtime.runtime_state_probe,
      workspace_write_probe: runtime.workspace_write_probe,
      processes: runtime.processes,
    };
  } catch (error) {
    primaryError = error;
  } finally {
    const cleanupErrors = [];
    const observe = (operation, fallback) => {
      try {
        return operation();
      } catch (error) {
        cleanupErrors.push(error);
        return fallback;
      }
    };
    try {
      const diagnosticRoot = resolve(artifactRoot, `diagnostics-${suffix}`);
      mkdirSync(diagnosticRoot, { recursive: true, mode: 0o700 });
      collectComposeFailureDiagnostics({
        run,
        composeCommand: launchCompose,
        project: runProject,
        artifactRoot: diagnosticRoot,
      });
    } catch (error) {
      diagnosticFailure = error;
    }
    const down = observe(
      () =>
        run(
          'docker',
          [...launchCompose, 'down', '--remove-orphans', '--volumes'],
          { allow: [0] },
        ),
      { status: null },
    );
    const containers = observe(
      () =>
        run('docker', [...launchCompose, 'ps', '-aq'], {
          allow: [0],
        })
          .stdout.trim()
          .split(/\r?\n/u)
          .filter(Boolean),
      ['cleanup-observation-failed'],
    );
    const networks = observe(
      () =>
        run('docker', [
          'network',
          'ls',
          '--filter',
          `label=com.docker.compose.project=${runProject}`,
          '--format',
          '{{.Name}}',
        ])
          .stdout.trim()
          .split(/\r?\n/u)
          .filter(Boolean),
      ['cleanup-observation-failed'],
    );
    const volumes = observe(
      () =>
        run('docker', [
          'volume',
          'ls',
          '--filter',
          `label=com.docker.compose.project=${runProject}`,
          '--format',
          '{{.Name}}',
        ])
          .stdout.trim()
          .split(/\r?\n/u)
          .filter(Boolean),
      ['cleanup-observation-failed'],
    );
    const providerAfter = observe(
      () =>
        run('docker', [
          'volume',
          'inspect',
          composeEnvironment.PROVIDER_TOOLCHAIN_VOLUME,
          '--format',
          '{{.Name}}',
        ]).stdout.trim(),
      'cleanup-observation-failed',
    );
    let cleanupProbeRecord = {};
    try {
      cleanupProbeRecord = runtimeBoundaryCleanupProbes(resultRecord, record);
    } catch (error) {
      cleanupErrors.push(error);
      cleanupFailure = error;
    }
    if (
      !cleanupFailure &&
      (containers.length || networks.length || volumes.length)
    )
      cleanupFailure = new Error(`${suffix}_mutation_cleanup_incomplete`);
    else if (!cleanupFailure && providerBefore !== providerAfter)
      cleanupFailure = new Error(`${suffix}_mutation_provider_volume_changed`);
    else if (!cleanupFailure && cleanupErrors.length)
      cleanupFailure = new Error(`${suffix}_mutation_cleanup_command_failed`);
    cleanupRecord = {
      project: runProject,
      ...cleanupProbeRecord,
      down_exit: down.status,
      remaining_project_containers: containers,
      remaining_project_networks: networks,
      remaining_project_volumes: volumes,
      external_provider_volume_before: providerBefore,
      external_provider_volume_after: providerAfter,
    };
    if (record && recordPath) {
      record.cleanup = cleanupRecord;
      writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, {
        mode: 0o600,
      });
    }
  }
  const mutationFailures = [
    primaryError
      ? {
          phase: 'primary',
          message: String(primaryError.message ?? primaryError),
        }
      : null,
    diagnosticFailure
      ? {
          phase: 'diagnostics',
          message: String(diagnosticFailure.message ?? diagnosticFailure),
        }
      : null,
    cleanupFailure
      ? {
          phase: 'cleanup',
          message: String(cleanupFailure.message ?? cleanupFailure),
        }
      : null,
  ].filter(Boolean);
  if (mutationFailures.length) {
    const firstFailure = primaryError ?? diagnosticFailure ?? cleanupFailure;
    const combined =
      firstFailure instanceof Error
        ? firstFailure
        : new Error(`${suffix}_mutation_failed`);
    combined.mutation_failures = mutationFailures;
    throw combined;
  }
  return { result: resultRecord, cleanup: cleanupRecord, recordPath };
}

async function runStandaloneMissingPaseoMutation() {
  const mutation = runRuntimeBoundaryMutation({
    suffix: 'e4nopaseo-standalone',
    name: 'remove-paseo-daemon-process',
    mutationSource: 'scripts/foundation/phase-c-e4-no-paseo-process.yaml',
    // runRuntimeBoundaryMutation supplies the no-port operational overlay.
    overlays: ['scripts/foundation/phase-c-e4-no-paseo-process.yaml'],
    expectedFailure: 'runtime_paseo_process_missing',
  });
  const record = JSON.parse(readFileSync(mutation.recordPath, 'utf8'));
  const runtime = record.runtime_inspection?.paseo_runtime;
  const agent = record.runtime_inspection?.agent_server;
  const exactFailure =
    mutation.result.exit === 1 &&
    mutation.result.status === 'FAIL' &&
    JSON.stringify(mutation.result.failures) ===
      JSON.stringify(['runtime_paseo_process_missing']);
  const nonTargetFactsGreen =
    runtimeIsNonroot(runtime?.identity) &&
    runtimeStateIsWritable(runtime?.runtime_state_probe) &&
    workspaceIsReadOnly(runtime?.workspace_write_probe) &&
    Array.isArray(runtime?.processes) &&
    runtime.processes.every((process) => !isPaseoExecutableProcess(process)) &&
    Array.isArray(agent?.processes) &&
    agent.processes.every((process) => !isPaseoProcess(process)) &&
    mutation.cleanup?.down_exit === 0 &&
    mutation.cleanup?.remaining_project_containers?.length === 0 &&
    mutation.cleanup?.remaining_project_networks?.length === 0 &&
    mutation.cleanup?.remaining_project_volumes?.length === 0 &&
    mutation.cleanup?.runtime_state_probe_file_present === false &&
    mutation.cleanup?.workspace_probe_file_present === false &&
    mutation.cleanup?.external_provider_volume_before ===
      mutation.cleanup?.external_provider_volume_after;
  if (!exactFailure) throw new Error('standalone_missing_paseo_not_exact_red');
  if (!nonTargetFactsGreen)
    throw new Error('standalone_missing_paseo_non_target_boundary_not_green');
  return {
    status: 'PASS',
    mode: 'missing-paseo-process',
    exact_failure: ['runtime_paseo_process_missing'],
    non_target_facts_green: true,
    runtime_record: mutation.recordPath,
    diagnostics: resolve(artifactRoot, 'diagnostics-e4nopaseo-standalone'),
    cleanup: mutation.cleanup,
  };
}

if (standaloneMutationMode) {
  await executeStandaloneMutation({
    runMutation: runStandaloneMissingPaseoMutation,
    output: (value) => process.stdout.write(value),
    exit: (code) => process.exit(code),
    secretValues: [
      process.env.OPENCODE_GO_API_KEY,
      ...secretValuesFromEnvironment(composeEnvironment),
    ],
  });
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
        identity: 'compose-effective-config',
        captureStdout: false,
      },
    ).stdout,
  );
  const sanitizedCompose = Object.entries(effective.services ?? {})
    .map(([name, service]) => sanitizeService(name, service))
    .sort((left, right) => left.name.localeCompare(right.name));

  runCriticalCompose(
    wrapper,
    [
      ...composeFiles,
      '-p',
      project,
      'up',
      '--build',
      '-d',
      '--wait',
      'postgres',
      'provider-toolchain-init',
      'paseo-runtime-state-init',
      'paseo-runtime',
      'agent-server',
    ],
    { identity: 'compose-up-build-wait' },
    rawCompose,
    project,
  );
  const runtimeRecord = {
    schema: 'agent-server.foundation.phase-c-runtime-record',
    version: 1,
    project,
    candidate_sha: candidateSha,
    captured_at: new Date().toISOString(),
    effective_compose: { services: sanitizedCompose },
    runtime_inspection: {
      containers: ['agent-server', 'paseo-runtime'],
      agent_server: containerRecord('agent-server'),
      paseo_runtime: {
        ...containerRecord('paseo-runtime'),
        identity: runtimeIdentity(rawCompose, 'runtime-identity'),
        runtime_state_probe: runtimeStateProbe(
          rawCompose,
          project,
          'runtime-state-write-probe',
        ),
        workspace_write_probe: workspaceWriteProbe(
          rawCompose,
          project,
          'runtime-workspace-write-probe',
        ),
      },
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
  let mutationRecord;
  let mutationRecordPath;
  let mutationCleanup;
  const mutationProviderBefore = run('docker', [
    'volume',
    'inspect',
    composeEnvironment.PROVIDER_TOOLCHAIN_VOLUME,
    '--format',
    '{{.Name}}',
  ]).stdout.trim();
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
          identity: 'mutation-compose-effective-config',
          captureStdout: false,
        },
      ).stdout,
    );
    runCriticalCompose(
      wrapper,
      [
        ...mutationFiles,
        '-p',
        mutationProject,
        'up',
        '-d',
        '--wait',
        'postgres',
        'provider-toolchain-init',
        'paseo-runtime-state-init',
        'paseo-runtime',
        'agent-server',
      ],
      { identity: 'mutation-compose-up-wait' },
      mutationCompose,
      mutationProject,
    );
    mutationRecordPath = resolve(artifactRoot, 'e4-mutation-record.json');
    mutationRecord = {
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
        paseo_runtime: {
          ...containerRecord('paseo-runtime', mutationCompose),
          identity: runtimeIdentity(
            mutationCompose,
            'mutation-runtime-identity',
          ),
          runtime_state_probe: runtimeStateProbe(
            mutationCompose,
            mutationProject,
            'mutation-runtime-state-write-probe',
          ),
          workspace_write_probe: workspaceWriteProbe(
            mutationCompose,
            mutationProject,
            'mutation-runtime-workspace-write-probe',
          ),
        },
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
    const mutationResult = JSON.parse(
      mutationRun.stdout.trim().split('\n').at(-1),
    );
    if (mutationRun.status !== 1 || mutationResult.status !== 'FAIL')
      throw new Error('e4_ownership_mutation_not_red');
    mutation = {
      name: 'restore-agent-provider-ownership',
      exit: mutationRun.status,
      status: mutationResult.status,
    };
  } finally {
    try {
      const diagnosticRoot = resolve(artifactRoot, 'diagnostics-e4red');
      mkdirSync(diagnosticRoot, { recursive: true, mode: 0o700 });
      collectComposeFailureDiagnostics({
        run,
        composeCommand: mutationCompose,
        project: mutationProject,
        artifactRoot: diagnosticRoot,
      });
    } catch {
      // Mutation diagnostics are secondary to its exact evaluator result.
    }
    const mutationDown = run(
      'docker',
      [...mutationCompose, 'down', '--remove-orphans', '--volumes'],
      { allow: [0] },
    );
    const mutationContainers = run(
      'docker',
      [...mutationCompose, 'ps', '-aq'],
      {
        allow: [0],
      },
    ).stdout.trim();
    const mutationNetworks = run('docker', [
      'network',
      'ls',
      '--filter',
      `label=com.docker.compose.project=${mutationProject}`,
      '--format',
      '{{.Name}}',
    ])
      .stdout.trim()
      .split(/\r?\n/u)
      .filter(Boolean);
    const mutationVolumes = run('docker', [
      'volume',
      'ls',
      '--filter',
      `label=com.docker.compose.project=${mutationProject}`,
      '--format',
      '{{.Name}}',
    ])
      .stdout.trim()
      .split(/\r?\n/u)
      .filter(Boolean);
    const mutationProviderAfter = run('docker', [
      'volume',
      'inspect',
      composeEnvironment.PROVIDER_TOOLCHAIN_VOLUME,
      '--format',
      '{{.Name}}',
    ]).stdout.trim();
    if (mutationContainers || mutationNetworks.length || mutationVolumes.length)
      throw new Error('e4_mutation_cleanup_incomplete');
    if (mutationProviderBefore !== mutationProviderAfter)
      throw new Error('e4_mutation_external_provider_volume_changed');
    mutationCleanup = {
      project: mutationProject,
      down_exit: mutationDown.status,
      remaining_project_containers: [],
      remaining_project_networks: mutationNetworks,
      remaining_project_volumes: mutationVolumes,
      external_provider_volume_before: mutationProviderBefore,
      external_provider_volume_after: mutationProviderAfter,
    };
    if (mutationRecord && mutationRecordPath) {
      mutationRecord.cleanup = mutationCleanup;
      writeFileSync(
        mutationRecordPath,
        `${JSON.stringify(mutationRecord, null, 2)}\n`,
        { mode: 0o600 },
      );
    }
  }

  const workspaceMutationProject = `${project}_e4rw`;
  const workspaceMutationFiles = [
    ...composeFiles,
    '-f',
    'scripts/foundation/phase-c-e4-no-ports.yaml',
    '-f',
    'scripts/foundation/phase-c-e4-workspace-rw-mutation.yaml',
  ];
  const workspaceMutationCompose = [
    'compose',
    '-p',
    workspaceMutationProject,
    ...workspaceMutationFiles,
  ];
  let workspaceMutation;
  let workspaceMutationRecord;
  let workspaceMutationRecordPath;
  let workspaceMutationCleanup;
  const workspaceMutationProviderBefore = run('docker', [
    'volume',
    'inspect',
    composeEnvironment.PROVIDER_TOOLCHAIN_VOLUME,
    '--format',
    '{{.Name}}',
  ]).stdout.trim();
  try {
    const workspaceMutationEffective = JSON.parse(
      run(
        wrapper,
        [
          ...workspaceMutationFiles,
          '-p',
          workspaceMutationProject,
          'config',
          '--format',
          'json',
        ],
        {
          env: {
            ...composeEnvironment,
            OPENCODE_GO_API_KEY: '__PHASE_C_CONFIG_REDACTED__',
          },
          identity: 'workspace-mutation-compose-effective-config',
          captureStdout: false,
        },
      ).stdout,
    );
    runCriticalCompose(
      wrapper,
      [
        ...workspaceMutationFiles,
        '-p',
        workspaceMutationProject,
        'up',
        '-d',
        '--wait',
        'postgres',
        'provider-toolchain-init',
        'paseo-runtime-state-init',
        'paseo-runtime',
        'agent-server',
      ],
      { identity: 'workspace-mutation-compose-up-wait' },
      workspaceMutationCompose,
      workspaceMutationProject,
    );
    const workspaceProbe = workspaceWriteProbe(
      workspaceMutationCompose,
      workspaceMutationProject,
      'workspace-mutation-runtime-write-probe',
    );
    if (!workspaceIsWritable(workspaceProbe))
      throw new Error('e4_workspace_rw_mutation_did_not_write');
    workspaceMutationRecordPath = resolve(
      artifactRoot,
      'e4-workspace-mutation-record.json',
    );
    workspaceMutationRecord = {
      schema: 'agent-server.foundation.phase-c-runtime-record',
      version: 1,
      project: workspaceMutationProject,
      candidate_sha: candidateSha,
      mutation: {
        name: 'restore-runtime-workspace-write-owner',
        source: 'scripts/foundation/phase-c-e4-workspace-rw-mutation.yaml',
        operational_overlay: 'scripts/foundation/phase-c-e4-no-ports.yaml',
      },
      effective_compose: {
        services: Object.entries(workspaceMutationEffective.services ?? {})
          .map(([name, service]) => sanitizeService(name, service))
          .sort((left, right) => left.name.localeCompare(right.name)),
      },
      runtime_inspection: {
        containers: ['agent-server', 'paseo-runtime'],
        agent_server: containerRecord('agent-server', workspaceMutationCompose),
        paseo_runtime: {
          ...containerRecord('paseo-runtime', workspaceMutationCompose),
          identity: runtimeIdentity(
            workspaceMutationCompose,
            'workspace-mutation-runtime-identity',
          ),
          runtime_state_probe: runtimeStateProbe(
            workspaceMutationCompose,
            workspaceMutationProject,
            'workspace-mutation-runtime-state-write-probe',
          ),
          workspace_write_probe: workspaceProbe,
        },
      },
    };
    writeFileSync(
      workspaceMutationRecordPath,
      `${JSON.stringify(workspaceMutationRecord, null, 2)}\n`,
      { mode: 0o600 },
    );
    const workspaceMutationRun = run(
      process.execPath,
      [
        'scripts/foundation/phase-c.mjs',
        'E4',
        '--runtime-record',
        workspaceMutationRecordPath,
      ],
      { allow: [1] },
    );
    const workspaceMutationResult = JSON.parse(
      workspaceMutationRun.stdout.trim().split('\n').at(-1),
    );
    if (
      workspaceMutationRun.status !== 1 ||
      workspaceMutationResult.status !== 'FAIL' ||
      JSON.stringify(workspaceMutationResult.failures) !==
        JSON.stringify(['runtime_workspace_read_only_boundary'])
    )
      throw new Error('e4_workspace_rw_mutation_not_red');
    workspaceMutation = {
      name: 'restore-runtime-workspace-write-owner',
      exit: workspaceMutationRun.status,
      status: workspaceMutationResult.status,
      failures: workspaceMutationResult.failures,
      workspace_write_probe: workspaceProbe,
    };
  } finally {
    try {
      const diagnosticRoot = resolve(artifactRoot, 'diagnostics-e4rw');
      mkdirSync(diagnosticRoot, { recursive: true, mode: 0o700 });
      collectComposeFailureDiagnostics({
        run,
        composeCommand: workspaceMutationCompose,
        project: workspaceMutationProject,
        artifactRoot: diagnosticRoot,
      });
    } catch {
      // Mutation diagnostics are secondary to its exact evaluator result.
    }
    let probeCleanup = { file_present: false };
    let probeCleanupError;
    let workspaceMutationDown;
    try {
      const runtimeContainer = run(
        'docker',
        [...workspaceMutationCompose, 'ps', '-q', 'paseo-runtime'],
        { allow: [0] },
      ).stdout.trim();
      if (runtimeContainer) {
        probeCleanup = removeWorkspaceProbe(
          workspaceMutationCompose,
          workspaceMutationProject,
          'workspace-mutation-probe-cleanup',
        );
      }
    } catch (error) {
      probeCleanupError = error;
    } finally {
      const hostProbePath = workspaceProbeHostPath(workspaceMutationProject);
      rmSync(hostProbePath, { force: true });
      probeCleanup = { file_present: existsSync(hostProbePath) };
      workspaceMutationDown = run(
        'docker',
        [...workspaceMutationCompose, 'down', '--remove-orphans', '--volumes'],
        { allow: [0] },
      );
    }
    const remainingContainers = run(
      'docker',
      [...workspaceMutationCompose, 'ps', '-aq'],
      { allow: [0] },
    ).stdout.trim();
    const remainingNetworks = run('docker', [
      'network',
      'ls',
      '--filter',
      `label=com.docker.compose.project=${workspaceMutationProject}`,
      '--format',
      '{{.Name}}',
    ])
      .stdout.trim()
      .split(/\r?\n/u)
      .filter(Boolean);
    const remainingVolumes = run('docker', [
      'volume',
      'ls',
      '--filter',
      `label=com.docker.compose.project=${workspaceMutationProject}`,
      '--format',
      '{{.Name}}',
    ])
      .stdout.trim()
      .split(/\r?\n/u)
      .filter(Boolean);
    const workspaceMutationProviderAfter = run('docker', [
      'volume',
      'inspect',
      composeEnvironment.PROVIDER_TOOLCHAIN_VOLUME,
      '--format',
      '{{.Name}}',
    ]).stdout.trim();
    if (
      remainingContainers ||
      remainingNetworks.length ||
      remainingVolumes.length
    )
      throw new Error('e4_workspace_mutation_cleanup_incomplete');
    if (workspaceMutationProviderBefore !== workspaceMutationProviderAfter)
      throw new Error('e4_workspace_mutation_external_provider_volume_changed');
    if (probeCleanup.file_present)
      throw new Error('e4_workspace_mutation_probe_cleanup_incomplete');
    if (probeCleanupError) throw probeCleanupError;
    workspaceMutationCleanup = {
      project: workspaceMutationProject,
      probe_file_present: probeCleanup.file_present,
      down_exit: workspaceMutationDown.status,
      remaining_project_containers: [],
      remaining_project_networks: remainingNetworks,
      remaining_project_volumes: remainingVolumes,
      external_provider_volume_before: workspaceMutationProviderBefore,
      external_provider_volume_after: workspaceMutationProviderAfter,
    };
    if (workspaceMutationRecord && workspaceMutationRecordPath) {
      workspaceMutationRecord.cleanup = workspaceMutationCleanup;
      writeFileSync(
        workspaceMutationRecordPath,
        `${JSON.stringify(workspaceMutationRecord, null, 2)}\n`,
        { mode: 0o600 },
      );
    }
  }

  const rootRuntimeMutation = runRuntimeBoundaryMutation({
    suffix: 'e4root',
    name: 'restore-long-lived-runtime-root-owner',
    mutationSource: 'scripts/foundation/phase-c-e4-root-runtime-mutation.yaml',
    overlays: ['scripts/foundation/phase-c-e4-root-runtime-mutation.yaml'],
    expectedFailure: 'nonroot_runtime_boundary',
  });
  if (
    runtimeIsNonroot(rootRuntimeMutation.result.identity) ||
    !runtimeStateIsWritable(rootRuntimeMutation.result.runtime_state_probe) ||
    !workspaceIsReadOnly(rootRuntimeMutation.result.workspace_write_probe)
  )
    throw new Error('e4_root_runtime_mutation_observation_invalid');

  const runtimeStateMutation = runRuntimeBoundaryMutation({
    suffix: 'e4state',
    name: 'remove-runtime-state-write-owner',
    mutationSource:
      'scripts/foundation/phase-c-e4-runtime-state-ro-mutation.yaml',
    overlays: [
      'scripts/foundation/phase-c-e4-runtime-state-ro-mutation.yaml',
      'scripts/foundation/phase-c-e4-runtime-state-carrier.yaml',
      'scripts/foundation/phase-c-e4-state-carrier-agent.yaml',
    ],
    expectedFailure: 'runtime_state_writable_boundary',
    instrumentation: 'failed-runtime-child-carrier',
  });
  if (
    !runtimeIsNonroot(runtimeStateMutation.result.identity) ||
    !runtimeStateIsReadOnly(runtimeStateMutation.result.runtime_state_probe) ||
    !workspaceIsReadOnly(runtimeStateMutation.result.workspace_write_probe) ||
    runtimeStateMutation.result.real_runtime_child_exit === 0 ||
    runtimeStateMutation.result.real_runtime_child_survived !== false
  )
    throw new Error('e4_runtime_state_mutation_observation_invalid');

  const noPaseoProcessMutation = runRuntimeBoundaryMutation({
    suffix: 'e4nopaseo',
    name: 'remove-paseo-daemon-process',
    mutationSource: 'scripts/foundation/phase-c-e4-no-paseo-process.yaml',
    overlays: ['scripts/foundation/phase-c-e4-no-paseo-process.yaml'],
    expectedFailure: 'runtime_paseo_process_missing',
  });
  if (
    noPaseoProcessMutation.result.processes.some(isPaseoExecutableProcess) ||
    !runtimeIsNonroot(noPaseoProcessMutation.result.identity) ||
    !runtimeStateIsWritable(
      noPaseoProcessMutation.result.runtime_state_probe,
    ) ||
    !workspaceIsReadOnly(noPaseoProcessMutation.result.workspace_write_probe)
  )
    throw new Error('e4_no_paseo_process_mutation_observation_invalid');

  const declarativeEnvironmentMutation = runEnvironmentOwnershipMutation({
    suffix: 'e4envdeclarative',
    name: 'restore-agent-provider-declarative-projection',
    mutationSource:
      'scripts/foundation/phase-c-e4-declarative-env-mutation.yaml',
    projectionOverlay:
      'scripts/foundation/phase-c-e4-declarative-env-mutation.yaml',
    launchOverlay: null,
    expectedFailures: [
      {
        proposition: 'agent_server_runtime_provider_environment',
        present: ['PASEO_PROVIDER'],
      },
    ],
  });
  const actualEnvironmentMutation = runEnvironmentOwnershipMutation({
    suffix: 'e4envactual',
    name: 'restore-agent-provider-actual-container',
    mutationSource: 'scripts/foundation/phase-c-e4-actual-env-mutation.yaml',
    projectionOverlay: null,
    launchOverlay: 'scripts/foundation/phase-c-e4-actual-env-mutation.yaml',
    expectedFailures: [
      {
        proposition: 'actual_agent_server_runtime_provider_environment',
        present: ['PASEO_PROVIDER'],
      },
    ],
  });
  if (
    !declarativeEnvironmentMutation.result.non_target_facts_green ||
    declarativeEnvironmentMutation.result.actual_provider_present ||
    !actualEnvironmentMutation.result.non_target_facts_green ||
    actualEnvironmentMutation.result.declarative_provider_present
  )
    throw new Error('e4_environment_mutation_isolation_invalid');

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
    {
      allow: [1],
      env: runEnvironment,
      identity: 'product-negative-control',
    },
  );
  const negativeResult = JSON.parse(negative.stdout.trim().split('\n').at(-1));
  if (negative.status !== 1 || negativeResult.status !== 'FAIL')
    throw new Error('negative_control_not_red');
  run(process.execPath, ['scripts/foundation/phase-c-real-run.mjs'], {
    env: runEnvironment,
    identity: 'product-positive-run',
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
  proof.expectation_commit = '99fd40e2ebbe0830ddf30a04676687008fe2a2ea';
  proof.expectation_git_object_sha256 =
    '0b466be1ecb4cfe715dd4e019249b8b454f1c61adb1a782c86295f72925d42d3';
  proof.agent_server_container_id =
    runtimeRecord.runtime_inspection.agent_server.container_id;
  proof.paseo_runtime_container_id =
    runtimeRecord.runtime_inspection.paseo_runtime.container_id;
  proof.runtime_record = 'runtime-record.json';
  proof.workspace_write_probe =
    runtimeRecord.runtime_inspection.paseo_runtime.workspace_write_probe;
  proof.runtime_identity =
    runtimeRecord.runtime_inspection.paseo_runtime.identity;
  proof.runtime_state_probe =
    runtimeRecord.runtime_inspection.paseo_runtime.runtime_state_probe;
  proof.e4_mutation = { ...mutation, cleanup: mutationCleanup };
  proof.e4_workspace_mutation = {
    ...workspaceMutation,
    cleanup: workspaceMutationCleanup,
  };
  proof.e4_root_runtime_mutation = {
    ...rootRuntimeMutation.result,
    cleanup: rootRuntimeMutation.cleanup,
  };
  proof.e4_runtime_state_mutation = {
    ...runtimeStateMutation.result,
    cleanup: runtimeStateMutation.cleanup,
  };
  proof.e4_no_paseo_process_mutation = {
    ...noPaseoProcessMutation.result,
    cleanup: noPaseoProcessMutation.cleanup,
  };
  proof.e4_declarative_environment_mutation = {
    ...declarativeEnvironmentMutation.result,
    cleanup: declarativeEnvironmentMutation.cleanup,
  };
  proof.e4_actual_environment_mutation = {
    ...actualEnvironmentMutation.result,
    cleanup: actualEnvironmentMutation.cleanup,
  };
  proof.accepted_e4_projection = runtimeRecord.effective_compose;
  proof.cleanup = cleanup();
  const generatedArtifactPaths = readdirSync(artifactRoot, {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath, entry.name));
  const serialized = [...new Set([...generatedArtifactPaths, proofPath])]
    .map((path) =>
      path === proofPath ? JSON.stringify(proof) : readFileSync(path, 'utf8'),
    )
    .join('\n');
  const secretHits = [...scannedTranscripts, serialized].filter((value) =>
    value.includes(process.env.OPENCODE_GO_API_KEY),
  ).length;
  if (secretHits !== 0) throw new Error('secret_scan_failed');
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
