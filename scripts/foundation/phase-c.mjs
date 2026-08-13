import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EXPECTATION_PATH = 'evidence/foundation/runtime-real-expectation.json';
const EXPECTATION_COMMIT = '99fd40e2ebbe0830ddf30a04676687008fe2a2ea';
const suites = new Set(['E4', 'E5', 'E6']);
const statusCode = { PASS: 0, FAIL: 1, MISSING: 2 };

function parseArgs(argv) {
  const result = {
    suites: [],
    options: {
      ...(process.env.FOUNDATION_RUNTIME_RECORD
        ? { 'runtime-record': process.env.FOUNDATION_RUNTIME_RECORD }
        : {}),
      ...(process.env.FOUNDATION_PROOF_RECORD
        ? { 'proof-record': process.env.FOUNDATION_PROOF_RECORD }
        : {}),
    },
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (suites.has(value)) result.suites.push(value);
    else if (value.startsWith('--')) {
      const next = argv[index + 1];
      if (!next || next.startsWith('--'))
        throw new Error(`${value} requires a value`);
      result.options[value.slice(2)] = next;
      index += 1;
    } else throw new Error(`unknown argument: ${value}`);
  }
  if (!result.suites.length) result.suites = ['E4', 'E5', 'E6'];
  return result;
}

function result(suite, status, reason, details = {}) {
  return { suite, status, code: statusCode[status], reason, ...details };
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return { __error: error instanceof Error ? error.message : String(error) };
  }
}

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function runVerifierMutation(args, environment = {}) {
  const child = spawnSync(
    process.execPath,
    [fileURLToPath(import.meta.url), ...args],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        FOUNDATION_PHASE_C_POSITIVE_ONLY: '1',
        ...environment,
      },
      encoding: 'utf8',
    },
  );
  const evaluation = child.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .at(-1);
  return {
    exit: child.status,
    status: evaluation?.status,
    reason: evaluation?.reason,
  };
}

function evaluateE4(options) {
  if (!options['runtime-record']) {
    return result(
      'E4',
      'MISSING',
      'runtime topology record has not been collected',
    );
  }
  const record = readJson(resolve(options['runtime-record']));
  if (record.__error) return result('E4', 'MISSING', record.__error);
  const compose = record.effective_compose;
  const runtime = record.runtime_inspection;
  const requiredCollections = [
    compose?.services,
    runtime?.containers,
    runtime?.agent_server?.processes,
    runtime?.agent_server?.environment_names,
    runtime?.paseo_runtime?.processes,
    runtime?.paseo_runtime?.environment_names,
    runtime?.paseo_runtime?.mounts,
  ];
  if (
    requiredCollections.some((value) => !Array.isArray(value) || !value.length)
  ) {
    return result('E4', 'MISSING', 'required topology collection is empty');
  }
  const agent = compose.services.find(
    (service) => service.name === 'agent-server',
  );
  const paseo = compose.services.find(
    (service) => service.name === 'paseo-runtime',
  );
  if (!agent || !paseo)
    return result('E4', 'FAIL', 'required services are absent');
  const forbiddenAgentServerEnvironment = new Set([
    'OPENCODE_GO_API_KEY',
    'PASEO_CONNECT_TIMEOUT_MS',
    'PASEO_EXECUTION_TIMEOUT_MS',
    'PASEO_SESSION_RPC_TIMEOUT_MS',
    'PASEO_PROVIDER',
    'PASEO_MODEL',
    'PASEO_DAEMON_STARTUP_TIMEOUT_MS',
    'PASEO_OPENCODE_SERVER_STARTUP_TIMEOUT_MS',
    'PASEO_PROVIDER_REFRESH_TIMEOUT_MS',
    'PASEO_OPENCODE_APP_AGENTS_TIMEOUT_MS',
    'PASEO_OPENCODE_PROVIDER_LIST_TIMEOUT_MS',
    'PASEO_OPENCODE_SESSION_CREATE_TIMEOUT_MS',
    'PASEO_PORT',
    'PASEO_LISTEN_HOST',
    'PASEO_CORS_ORIGINS',
    'PASEO_HOSTNAMES',
    'PASEO_HOME',
    'XDG_CONFIG_HOME',
    'XDG_DATA_HOME',
    'XDG_CACHE_HOME',
    'PASEO_RELAY_ENABLED',
    'PASEO_DICTATION_ENABLED',
    'PASEO_VOICE_MODE_ENABLED',
    'PASEO_DEV_WEB_UI',
  ]);
  const failures = [];
  if (!/^[0-9a-f]{40}$/u.test(record.candidate_sha ?? ''))
    failures.push('candidate_sha');
  if (agent.command?.some((part) => String(part).includes('with-paseo')))
    failures.push('agent_server_supervises_paseo');
  if (agent.depends_on?.includes('provider-toolchain-init'))
    failures.push('agent_server_provider_dependency');
  if (
    agent.mounts?.some(
      (mount) => mount.target === '/opt/provider-toolchain-volume',
    )
  )
    failures.push('agent_server_provider_mount');
  const forbiddenEnvironmentPresent = Object.keys(agent.environment ?? {})
    .filter(
      (name) =>
        forbiddenAgentServerEnvironment.has(name) ||
        name.startsWith('ANTHROPIC_'),
    )
    .sort();
  if (forbiddenEnvironmentPresent.length) {
    failures.push({
      proposition: 'agent_server_runtime_provider_environment',
      present: forbiddenEnvironmentPresent,
    });
  }
  if (agent.environment?.PASEO_WS_URL !== 'ws://paseo-runtime:16767/ws')
    failures.push('agent_server_socket_boundary');
  if (!paseo.depends_on?.includes('provider-toolchain-init'))
    failures.push('runtime_init_dependency');
  if (
    !paseo.mounts?.some(
      (mount) => mount.target === '/opt/provider-toolchain-volume',
    )
  )
    failures.push('runtime_provider_mount');
  const requiredRuntimeEnvironment = [
    'OPENCODE_GO_API_KEY',
    'PASEO_PROVIDER',
    'PASEO_MODEL',
    'PASEO_CONNECT_TIMEOUT_MS',
    'PASEO_EXECUTION_TIMEOUT_MS',
    'PASEO_SESSION_RPC_TIMEOUT_MS',
    'PASEO_DAEMON_STARTUP_TIMEOUT_MS',
    'PASEO_OPENCODE_SERVER_STARTUP_TIMEOUT_MS',
    'PASEO_PROVIDER_REFRESH_TIMEOUT_MS',
    'PASEO_OPENCODE_APP_AGENTS_TIMEOUT_MS',
    'PASEO_OPENCODE_PROVIDER_LIST_TIMEOUT_MS',
    'PASEO_OPENCODE_SESSION_CREATE_TIMEOUT_MS',
    'HOME',
    'PASEO_HOME',
    'XDG_CONFIG_HOME',
    'XDG_DATA_HOME',
    'XDG_CACHE_HOME',
  ];
  const runtimeEnvironmentMissing = requiredRuntimeEnvironment.filter(
    (name) => !(name in (paseo.environment ?? {})),
  );
  if (runtimeEnvironmentMissing.length) {
    failures.push({
      proposition: 'runtime_environment_ownership',
      missing: runtimeEnvironmentMissing,
    });
  }
  const actualAgentForbiddenEnvironment = runtime.agent_server.environment_names
    .filter(
      (name) =>
        forbiddenAgentServerEnvironment.has(name) ||
        name.startsWith('ANTHROPIC_'),
    )
    .sort();
  if (actualAgentForbiddenEnvironment.length) {
    failures.push({
      proposition: 'actual_agent_server_runtime_provider_environment',
      present: actualAgentForbiddenEnvironment,
    });
  }
  if (
    runtime.agent_server.mounts.some(
      (mount) => mount.destination === '/opt/provider-toolchain-volume',
    )
  )
    failures.push('actual_agent_server_provider_mount');
  const actualRuntimeEnvironmentMissing = requiredRuntimeEnvironment.filter(
    (name) => !runtime.paseo_runtime.environment_names.includes(name),
  );
  if (actualRuntimeEnvironmentMissing.length) {
    failures.push({
      proposition: 'actual_runtime_environment_ownership',
      missing: actualRuntimeEnvironmentMissing,
    });
  }
  if (
    !runtime.paseo_runtime.mounts.some(
      (mount) =>
        mount.destination === '/opt/provider-toolchain-volume' &&
        mount.read_only === true,
    )
  )
    failures.push('actual_runtime_provider_mount');
  if (
    runtime.agent_server.processes.some((process) =>
      /(?:^|\/)paseo(?:\s|$)/u.test(process.command),
    )
  )
    failures.push('agent_server_paseo_process');
  if (
    !runtime.paseo_runtime.processes.some((process) =>
      /(?:^|\/)paseo(?:\s|$)/u.test(process.command),
    )
  )
    failures.push('runtime_paseo_process_missing');
  if (runtime.agent_server.container_id === runtime.paseo_runtime.container_id)
    failures.push('container_identity_not_independent');
  if (failures.length)
    return result('E4', 'FAIL', 'runtime ownership proposition failed', {
      failures,
    });
  if (process.env.FOUNDATION_PHASE_C_POSITIVE_ONLY === '1')
    return result(
      'E4',
      'PASS',
      'effective and running topology establish external runtime ownership',
    );
  const mutationRoot = mkdtempSync(join(tmpdir(), 'phase-c-e4-mutation-'));
  const mutationPath = join(mutationRoot, 'runtime-record.json');
  const mutated = structuredClone(record);
  mutated.runtime_inspection.agent_server.environment_names.push(
    'PASEO_PROVIDER',
  );
  writeFileSync(mutationPath, `${JSON.stringify(mutated)}\n`);
  const mutation = runVerifierMutation([
    'E4',
    '--runtime-record',
    mutationPath,
  ]);
  rmSync(mutationRoot, { recursive: true, force: true });
  if (mutation.exit !== 1 || mutation.status !== 'FAIL')
    return result(
      'E4',
      'MISSING',
      'ownership-restoration mutation was not red',
      { mutation },
    );
  return result(
    'E4',
    'PASS',
    'effective and running topology establish external runtime ownership',
    {
      mutations: [{ name: 'restore-agent-provider-env-owner', ...mutation }],
    },
  );
}

const runtimeTargets = ['web-dev', 'mixed-team-journey', 'web-e2e-smoke'];
function recipeFor(makefile, target) {
  const match = new RegExp(`^${target}:\\n((?:\\t.*\\n)+)`, 'mu').exec(
    makefile,
  );
  return match?.[1] ?? '';
}

function evaluateE5() {
  const makefilePath = resolve(
    process.env.FOUNDATION_E5_MAKEFILE ?? join(ROOT, 'Makefile'),
  );
  const makefile = readFileSync(makefilePath, 'utf8');
  const structuralFailures = runtimeTargets.filter(
    (target) =>
      !recipeFor(makefile, target).startsWith(
        `\t@./scripts/dev/runtime-only-preflight ${target}\n`,
      ),
  );
  if (structuralFailures.length) {
    return result(
      'E5',
      'FAIL',
      'runtime-only preflight is missing or not first',
      {
        structural_failures: structuralFailures,
      },
    );
  }
  const positive = [];
  for (const target of runtimeTargets) {
    const traceRoot = mkdtempSync(join(tmpdir(), 'phase-c-e5-'));
    const trace = join(traceRoot, 'trace.log');
    const run = spawnSync(
      'make',
      ['--no-print-directory', '-s', '-f', makefilePath, target],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          AGENT_SERVER_COMPOSITION: 'core',
          RUNTIME_PREFLIGHT_TRACE_FILE: trace,
        },
        encoding: 'utf8',
      },
    );
    const boundary = readFileSync(trace, 'utf8').trim();
    rmSync(traceRoot, { recursive: true, force: true });
    positive.push({
      target,
      exit: run.status,
      reason_seen: run.stderr.includes(
        `RUNTIME_ONLY_TARGET_REQUIRES_RUNTIME: ${target}`,
      ),
      boundary,
      polling_seen: /health\/ready/u.test(`${run.stdout}${run.stderr}`),
    });
  }
  const badPositive = positive.find(
    (item) =>
      item.exit !== 2 ||
      !item.reason_seen ||
      item.polling_seen ||
      item.boundary !== `${item.target}\tcore`,
  );
  if (badPositive)
    return result('E5', 'FAIL', 'runtime-only positive preflight failed', {
      positive,
    });

  if (process.env.FOUNDATION_E5_POSITIVE_ONLY === '1') {
    return result('E5', 'PASS', 'runtime-only positive preflight passed', {
      positive,
    });
  }

  const mutations = [];
  for (const target of runtimeTargets) {
    const originalRecipe = recipeFor(makefile, target);
    if (!originalRecipe)
      return result('E5', 'MISSING', `recipe missing: ${target}`);
    const mutated = makefile.replace(
      `\t@./scripts/dev/runtime-only-preflight ${target}\n`,
      '',
    );
    const mutatedRecipe = recipeFor(mutated, target);
    const mutationRoot = mkdtempSync(join(tmpdir(), 'phase-c-e5-mutation-'));
    const mutationMakefile = join(mutationRoot, 'Makefile');
    writeFileSync(mutationMakefile, mutated);
    const mutationRun = spawnSync(
      process.execPath,
      [fileURLToPath(import.meta.url), 'E5'],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          FOUNDATION_E5_MAKEFILE: mutationMakefile,
          FOUNDATION_E5_POSITIVE_ONLY: '1',
        },
        encoding: 'utf8',
      },
    );
    const mutationEvaluation = mutationRun.stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .at(-1);
    rmSync(mutationRoot, { recursive: true, force: true });
    mutations.push({
      target,
      mutation: 'remove-runtime-only-preflight',
      diff_sha256: sha256(`${target}\n${originalRecipe}\n${mutatedRecipe}`),
      preflight_removed: !mutatedRecipe.includes(
        `runtime-only-preflight ${target}`,
      ),
      polling_sentinel_reachable: /health\/ready/u.test(mutatedRecipe),
      verifier_exit: mutationRun.status,
      verifier_status: mutationEvaluation?.status,
      verifier_reason: mutationEvaluation?.reason,
    });
  }
  if (
    mutations.some(
      (item) =>
        !item.preflight_removed ||
        !item.polling_sentinel_reachable ||
        item.verifier_exit !== 1 ||
        item.verifier_status !== 'FAIL',
    )
  ) {
    return result(
      'E5',
      'MISSING',
      'mutation did not produce a real verifier failure',
      { mutations },
    );
  }
  return result(
    'E5',
    'PASS',
    'all runtime-only targets fail at the preflight boundary and every removal mutation is red',
    { positive, mutations },
  );
}

function git(...args) {
  return execFileSync('git', ['-C', ROOT, ...args], {
    encoding: 'utf8',
  }).trim();
}

function evaluateE6(options) {
  const expectation = readJson(join(ROOT, EXPECTATION_PATH));
  if (expectation.__error) return result('E6', 'MISSING', expectation.__error);
  const committedBytes = execFileSync('git', [
    '-C',
    ROOT,
    'show',
    `${EXPECTATION_COMMIT}:${EXPECTATION_PATH}`,
  ]);
  const committed = JSON.parse(committedBytes.toString('utf8'));
  if (
    sha256(JSON.stringify(committed)) !== sha256(JSON.stringify(expectation))
  ) {
    return result(
      'E6',
      'FAIL',
      'working expectation differs from the committed Git object',
    );
  }
  if (!options['proof-record'] && !options['proof-path']) {
    return result(
      'E6',
      'MISSING',
      'real-run proof record has not been committed',
      {
        expectation_commit: EXPECTATION_COMMIT,
      },
    );
  }
  const proofPath = options['proof-path'] ?? options['proof-record'];
  if (
    options['proof-path'] &&
    (proofPath.startsWith('/') || proofPath.split('/').includes('..'))
  )
    return result('E6', 'FAIL', 'proof path must be canonical repo-relative');
  const resolvedProofPath = resolve(ROOT, proofPath);
  if (!resolvedProofPath.startsWith(`${ROOT}/`))
    return result('E6', 'FAIL', 'proof path escapes repository');
  const proofBytes = readFileSync(resolvedProofPath, 'utf8');
  const proof = readJson(resolvedProofPath);
  if (proof.__error) return result('E6', 'MISSING', proof.__error);
  const required = [
    proof.work_id,
    proof.work_run_id,
    proof.agent_server_container_id,
    proof.paseo_runtime_container_id,
  ];
  if (required.some((value) => !nonempty(value)))
    return result('E6', 'MISSING', 'required proof identity is empty');
  const failures = [];
  if (
    proof.expectation_commit !== EXPECTATION_COMMIT ||
    proof.expectation_git_object_sha256 !== sha256(committedBytes) ||
    proof.expectation_git_object_sha256 !==
      '0b466be1ecb4cfe715dd4e019249b8b454f1c61adb1a782c86295f72925d42d3'
  )
    failures.push('expectation_git_object_provenance');
  if (!/^[0-9a-f]{40}$/u.test(proof.candidate_sha ?? ''))
    failures.push('candidate_sha');
  if (proof.terminal_state !== expectation.expected_terminal_state)
    failures.push('terminal_state');
  if (
    proof.observed_success?.product_state !== 'complete' ||
    proof.observed_success?.problem_kind !== null ||
    !Array.isArray(proof.observed_success?.trace_run_statuses) ||
    !proof.observed_success.trace_run_statuses.length ||
    proof.observed_success.trace_run_statuses.some(
      (run) => !nonempty(run.run_id) || run.status !== 'succeeded',
    ) ||
    !Array.isArray(proof.observed_success?.fetched_run_statuses) ||
    proof.observed_success.fetched_run_statuses.length !==
      proof.observed_success.trace_run_statuses.length ||
    proof.observed_success.fetched_run_statuses.some(
      (run, index) =>
        run.run_id !==
          proof.observed_success.trace_run_statuses[index]?.run_id ||
        run.status !== 'succeeded',
    )
  )
    failures.push('observed_success');
  if (
    proof.marker_input !== proof.marker_output ||
    !nonempty(proof.marker_input)
  )
    failures.push('exact_marker_round_trip');
  if (
    proof.parallel_business_observation?.work_count !== 2 ||
    proof.parallel_business_observation?.accepted_work_ids?.length !== 2 ||
    !Array.isArray(proof.parallel_business_observation?.assignment_edges) ||
    proof.parallel_business_observation.assignment_edges.length !== 2 ||
    proof.parallel_business_observation.assignment_edges
      .map((edge) => edge.work_item_id)
      .sort()
      .join('\n') !==
      [...proof.parallel_business_observation.accepted_work_ids]
        .sort()
        .join('\n') ||
    proof.parallel_business_observation?.distinct_assignee_actor_count !== 2 ||
    new Set(
      proof.parallel_business_observation.assignment_edges.map(
        (edge) => edge.assignee_actor_id,
      ),
    ).size !== 2 ||
    proof.parallel_business_observation?.dependency_counts?.some(
      (count) => count !== 0,
    ) ||
    proof.parallel_business_observation?.lead_result_summary !==
      proof.marker_input ||
    proof.parallel_business_observation?.projection_status !==
      'internally_anchored' ||
    proof.parallel_business_observation?.trace_projection_status !==
      'internally_anchored' ||
    proof.parallel_business_observation?.overlap_observed !== true ||
    !Array.isArray(proof.parallel_business_observation?.worker_run_windows) ||
    new Set(
      proof.parallel_business_observation.worker_run_windows.map(
        (run) => run.work_item_id,
      ),
    ).size !== 2
  )
    failures.push('parallel_business_predicate');
  if (
    proof.provider !== expectation.runtime.provider ||
    proof.model !== expectation.runtime.model
  )
    failures.push('provider_model');
  if (!(proof.input_tokens > 0) || !(proof.output_tokens > 0))
    failures.push('positive_token_usage');
  if (proof.agent_server_container_id === proof.paseo_runtime_container_id)
    failures.push('independent_container_identity');
  if (proof.secret_hits !== 0) failures.push('secret_scan');
  if (
    proof.negative_control?.exit !== 1 ||
    proof.negative_control?.status !== 'FAIL' ||
    proof.negative_control?.http_status !== 400 ||
    proof.negative_control?.error_code !== 'invalid_work_definition' ||
    proof.negative_control?.error_message !==
      'The definition and published version must belong to this owner scope and lineage.' ||
    proof.negative_control?.request_id_present !== true
  )
    failures.push('negative_control');
  if (
    proof.cleanup?.down_exit !== 0 ||
    proof.cleanup?.remaining_project_containers?.length !== 0 ||
    proof.cleanup?.remaining_project_networks?.length !== 0 ||
    proof.cleanup?.remaining_project_volumes?.length !== 0 ||
    !nonempty(proof.cleanup?.external_provider_volume_before) ||
    proof.cleanup?.external_provider_volume_before !==
      proof.cleanup?.external_provider_volume_after
  )
    failures.push('scoped_cleanup');
  if (proof.stage !== 'raw_run_evidence') failures.push('proof_stage');
  if (failures.length)
    return result('E6', 'FAIL', 'raw real-run evidence proposition failed', {
      failures,
    });
  const proofCommit = options['proof-commit'];
  const canonicalSwitchCommit = options['canonical-switch-commit'];
  if (!nonempty(proofCommit) || !nonempty(canonicalSwitchCommit)) {
    return result(
      'E6',
      'MISSING',
      'raw evidence is valid; proof and canonical-switch Git objects do not exist yet',
      { stage: proof.stage },
    );
  }
  if (!options['proof-path'])
    return result('E6', 'FAIL', 'final verification requires --proof-path');
  let committedProofBytes;
  try {
    committedProofBytes = `${git('show', `${proofCommit}:${proofPath}`)}\n`;
  } catch {
    return result('E6', 'FAIL', 'proof Git object is missing');
  }
  if (
    committedProofBytes !== proofBytes ||
    sha256(committedProofBytes) !== sha256(proofBytes)
  )
    failures.push('proof_git_object_bytes');
  const expectationTime = Number(
    git('show', '-s', '--format=%ct', EXPECTATION_COMMIT),
  );
  const runTime = Math.floor(Date.parse(proof.run_timestamp) / 1000);
  const proofTime = Number(git('show', '-s', '--format=%ct', proofCommit));
  const switchTime = Number(
    git('show', '-s', '--format=%ct', canonicalSwitchCommit),
  );
  if (!(
    expectationTime < runTime &&
    runTime < proofTime &&
    proofTime < switchTime
  ))
    failures.push('chronology');
  try {
    git('merge-base', '--is-ancestor', EXPECTATION_COMMIT, proofCommit);
    git('merge-base', '--is-ancestor', proof.candidate_sha, proofCommit);
    git('merge-base', '--is-ancestor', proofCommit, canonicalSwitchCommit);
  } catch {
    failures.push('ancestry');
  }
  try {
    const switchFiles = git(
      'diff-tree',
      '--no-commit-id',
      '--name-only',
      '-r',
      canonicalSwitchCommit,
    )
      .split('\n')
      .filter(Boolean);
    const switchMakefile = git('show', `${canonicalSwitchCommit}:Makefile`);
    const canonicalTargets = [
      'setup',
      'dev',
      'dev-api',
      'web-dev',
      'web-e2e-smoke',
      'mixed-team-journey',
      'provider-smoke',
    ];
    const targetSelectsExternal = (target) => {
      const recipe = recipeFor(switchMakefile, target);
      if (recipe.includes('compose.external-runtime.yaml')) return true;
      const variables = [...recipe.matchAll(/\$\(([^)]+)\)/gu)].map(
        (match) => match[1],
      );
      return variables.some((name) =>
        new RegExp(
          `^${name}\\s*[:?+]?=.*compose\\.external-runtime\\.yaml`,
          'mu',
        ).test(switchMakefile),
      );
    };
    if (
      !switchFiles.includes('Makefile') ||
      canonicalTargets.some((target) => !targetSelectsExternal(target))
    )
      failures.push('canonical_switch_exact_commit');
  } catch {
    failures.push('canonical_switch_exact_commit');
  }
  if (failures.length)
    return result('E6', 'FAIL', 'real-run proof proposition failed', {
      failures,
    });
  if (process.env.FOUNDATION_PHASE_C_POSITIVE_ONLY === '1')
    return result(
      'E6',
      'PASS',
      'real-run proof, negative control, chronology, and ancestry passed',
    );
  const mutationRoot = mkdtempSync(join(tmpdir(), 'phase-c-e6-mutation-'));
  const tamperedPath = join(mutationRoot, 'proof.json');
  const tampered = structuredClone(proof);
  tampered.marker_output = 'PHASEC_00000000000000000000000000000000';
  writeFileSync(tamperedPath, `${JSON.stringify(tampered, null, 2)}\n`);
  const tamperedMutation = runVerifierMutation([
    'E6',
    '--proof-record',
    tamperedPath,
  ]);
  const chronologyMutation = runVerifierMutation([
    'E6',
    '--proof-path',
    proofPath,
    '--proof-commit',
    canonicalSwitchCommit,
    '--canonical-switch-commit',
    proofCommit,
  ]);
  rmSync(mutationRoot, { recursive: true, force: true });
  const mutations = [
    { name: 'tamper-marker-proof', ...tamperedMutation },
    { name: 'reverse-proof-switch-chronology', ...chronologyMutation },
  ];
  if (
    mutations.some(
      (mutation) => mutation.exit !== 1 || mutation.status !== 'FAIL',
    )
  )
    return result('E6', 'MISSING', 'E6 mutation was not red', { mutations });
  return result(
    'E6',
    'PASS',
    'real-run proof, negative control, chronology, and ancestry passed',
    { mutations },
  );
}

let parsed;
try {
  parsed = parseArgs(process.argv.slice(2));
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(2);
}
const evaluations = parsed.suites.map((suite) =>
  suite === 'E4'
    ? evaluateE4(parsed.options)
    : suite === 'E5'
      ? evaluateE5()
      : evaluateE6(parsed.options),
);
for (const evaluation of evaluations)
  process.stdout.write(`${JSON.stringify(evaluation)}\n`);
process.exitCode = Math.max(
  ...evaluations.map((evaluation) => evaluation.code),
);
