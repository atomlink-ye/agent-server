#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { mkdir, realpath } from 'node:fs/promises';
import { Client } from 'pg';

import {
  captureProductRun,
  SUBMIT_INSTRUCTION_PROFILE,
} from './lib/capture-product-run.mjs';

const SCENARIO = 'oi38-negative';
const MEMBER_COMPOSITION = Object.freeze([
  'projection-lead',
  'projection-worker-a',
  'projection-worker-b',
]);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const WORKSPACE_ROOT = '/workspace';
const ARTIFACT_ROOT = '/workspace/recording-artifacts';

function fail(code, detail = '') {
  throw new Error(`${code}${detail ? `:${detail}` : ''}`);
}

function parseArgs(argv) {
  const allowed = new Set([
    '--base-url',
    '--root-task-id',
    '--work-id',
    '--work-run-id',
    '--capture-git-sha',
  ]);
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(name) || !value || value.startsWith('--') || parsed[name])
      fail('invalid_cli_arguments');
    parsed[name] = value;
  }
  if (argv.length % 2 !== 0) fail('invalid_cli_arguments');
  return parsed;
}

function environment(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function requiredEnvironment(label, ...names) {
  const value = environment(...names);
  if (!value) fail(`${label}_required`);
  return value;
}

function requiredId(value, label) {
  if (!value || !UUID.test(value)) fail(`${label}_required_or_invalid`);
  return value;
}

async function validatedOutputRoot(value) {
  const outputRoot = resolve(value);
  const workspaceRoot = resolve(WORKSPACE_ROOT);
  const artifactRoot = resolve(ARTIFACT_ROOT);
  const within = (root, path) => {
    const pathFromRoot = relative(root, path);
    return (
      pathFromRoot === '' ||
      (!pathFromRoot.startsWith(`..${sep}`) &&
        pathFromRoot !== '..' &&
        !isAbsolute(pathFromRoot))
    );
  };
  if (
    !within(artifactRoot, outputRoot) ||
    outputRoot === artifactRoot
  )
    fail('product_recordings_root_workspace_boundary_invalid');
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const workspaceReal = await realpath(workspaceRoot).catch(() => null);
  const artifactReal = await realpath(artifactRoot).catch(() => null);
  const parentReal = await realpath(dirname(outputRoot)).catch(() => null);
  if (
    workspaceReal !== workspaceRoot ||
    artifactReal !== artifactRoot ||
    (parentReal !== null && !within(artifactRoot, parentReal))
  )
    fail('product_recordings_root_realpath_invalid');
  return outputRoot;
}

function readGitRevision(value) {
  const revision = value?.trim();
  if (!/^[0-9a-f]{40}$/u.test(revision)) fail('git_revision_missing');
  return revision;
}

async function snapshot(baseUrl, token, path) {
  const response = await fetch(new URL(path, baseUrl), {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
  });
  return {
    status: response.status,
    body: await response.json().catch(() => null),
  };
}

async function acceptedGet(baseUrl, token, path) {
  const response = await snapshot(baseUrl, token, path);
  if (response.status < 200 || response.status >= 300)
    fail(
      `accepted_get_${response.status}`,
      response.body?.error?.code ?? 'request_failed',
    );
  return response.body;
}

async function readHistoricalDefinitionHash(
  client,
  rootTaskId,
  tenantId,
  workspaceId,
  principalType,
  principalId,
) {
  const teamVersions = await client.query(
    `SELECT DISTINCT tr.team_version_id
       FROM team_runs tr
      WHERE tr.root_task_id=$1
        AND tr.tenant_id=$2
        AND tr.workspace_id=$3
        AND tr.principal_type=$4
        AND tr.principal_id=$5
      ORDER BY tr.team_version_id`,
    [rootTaskId, tenantId, workspaceId, principalType, principalId],
  );
  if (teamVersions.rows.length !== 1) {
    fail(
      teamVersions.rows.length === 0
        ? 'historical_team_version_missing'
        : 'historical_team_version_ambiguous',
    );
  }
  const teamVersionId = teamVersions.rows[0].team_version_id;
  const imports = await client.query(
    `SELECT request_fingerprint
       FROM team_registry_idempotency
      WHERE operation='import'
        AND version_id=$1
        AND tenant_id=$2
        AND workspace_id=$3
        AND principal_type=$4
        AND principal_id=$5
      ORDER BY created_at,idempotency_key
      LIMIT 2`,
    [
      teamVersionId,
      tenantId,
      workspaceId,
      principalType,
      principalId,
    ],
  );
  if (imports.rows.length !== 1)
    fail(
      imports.rows.length === 0
        ? 'historical_definition_fingerprint_missing'
        : 'historical_definition_fingerprint_ambiguous',
    );
  const fingerprint = String(imports.rows[0].request_fingerprint ?? '');
  if (!/^sha256:[0-9a-f]{64}$/u.test(fingerprint))
    fail('historical_definition_fingerprint_invalid');
  return fingerprint.slice('sha256:'.length);
}

function providerEvidenceFromTrace(trace) {
  const runtimes = (Array.isArray(trace?.runs) ? trace.runs : []).filter(
    (run) =>
      typeof run?.provider === 'string' &&
      run.provider.trim() &&
      typeof run?.model === 'string' &&
      run.model.trim(),
  );
  if (!runtimes.length) fail('historical_provider_runtime_evidence_missing');
  if (
    runtimes.some((run) =>
      /fake|scripted|stub|mock/iu.test(`${run.provider} ${run.model}`),
    )
  )
    fail('fake_or_scripted_provider_evidence_rejected');
  return {
    providerKind: [...new Set(runtimes.map((run) => run.provider))]
      .sort()
      .join(','),
    providerModel: [...new Set(runtimes.map((run) => run.model))]
      .sort()
      .join(','),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = new URL(
    args['--base-url'] ??
      requiredEnvironment(
        'base_url',
        'AGENT_SERVER_URL',
        'AGENT_SERVER_BASE_URL',
      ),
  );
  const ownerToken = requiredEnvironment(
    'agent_server_token',
    'AGENT_SERVER_TOKEN',
    'AGENT_SERVER_SERVICE_TOKEN',
    'SERVICE_ACCOUNT_TOKEN',
  );
  const foreignToken = requiredEnvironment(
    'oi38_foreign_token',
    'AGENT_SERVER_FOREIGN_TOKEN',
    'OI38_FOREIGN_TOKEN',
  );
  if (ownerToken === foreignToken) fail('oi38_foreign_token_matches_owner');

  const rootTaskId = requiredId(
    args['--root-task-id'] ??
      requiredEnvironment(
        'root_task_id',
        'PRODUCT_E2E_ROOT_TASK_ID',
        'PRODUCT_ROOT_TASK_ID',
        'ROOT_TASK_ID',
      ),
    'root_task_id',
  );
  const workId = requiredId(
    args['--work-id'] ??
      requiredEnvironment(
        'work_id',
        'PRODUCT_E2E_WORK_ID',
        'PRODUCT_WORK_ID',
        'WORK_ID',
      ),
    'work_id',
  );
  const workRunId = requiredId(
    args['--work-run-id'] ??
      requiredEnvironment(
        'work_run_id',
        'PRODUCT_E2E_WORK_RUN_ID',
        'PRODUCT_WORK_RUN_ID',
        'WORK_RUN_ID',
      ),
    'work_run_id',
  );

  const outputRoot = await validatedOutputRoot(
    requiredEnvironment('product_recordings_root', 'PRODUCT_RECORDINGS_ROOT'),
  );
  const databaseUrl = requiredEnvironment(
    'database_url',
    'DATABASE_URL',
    'POSTGRES_URL',
  );
  const tenantId = requiredEnvironment(
    'authenticated_tenant',
    'AGENT_TENANT_ID',
    'AGENT_SERVER_TENANT_ID',
  );
  const workspaceId = requiredEnvironment(
    'authenticated_workspace',
    'AGENT_WORKSPACE_ID',
    'AGENT_SERVER_WORKSPACE_ID',
  );
  const principalId = requiredEnvironment(
    'authenticated_principal',
    'AGENT_PRINCIPAL_ID',
    'SERVICE_ACCOUNT_ID',
    'AGENT_SERVER_SERVICE_ACCOUNT_ID',
  );
  const principalType =
    environment('AGENT_PRINCIPAL_TYPE') ?? 'service_account';
  const client = new Client({ connectionString: databaseUrl });
  let connected = false;
  try {
    await client.connect();
    connected = true;
    const definitionHash = await readHistoricalDefinitionHash(
      client,
      rootTaskId,
      tenantId,
      workspaceId,
      principalType,
      principalId,
    );
    const serviceRevision = readGitRevision(args['--capture-git-sha']);
    const product = await acceptedGet(
      baseUrl,
      ownerToken,
      `/api/v1/works/${workId}/runs/${workRunId}`,
    );
    const trace = await acceptedGet(
      baseUrl,
      ownerToken,
      `/api/v1/works/${workId}/runs/${workRunId}/trace`,
    );
    const { providerKind, providerModel } = providerEvidenceFromTrace(trace);

    // OI-38 requires an owner positive control and indistinguishable foreign
    // and missing-work negative controls.  These are GET-only probes.
    const owner = await snapshot(
      baseUrl,
      ownerToken,
      `/api/v1/works/${workId}/runs?limit=100`,
    );
    const foreign = await snapshot(
      baseUrl,
      foreignToken,
      `/api/v1/works/${workId}/runs?limit=100`,
    );
    const missingWorkId = randomUUID();
    const missing = await snapshot(
      baseUrl,
      foreignToken,
      `/api/v1/works/${missingWorkId}/runs?limit=100`,
    );

    const capture = await captureProductRun({
      baseUrl,
      token: ownerToken,
      rootTaskId,
      workId,
      workRunId,
      work: product?.work,
      workRun: product?.work_run,
      workRunResponse: product,
      trace,
      tenantId,
      workspaceId,
      principalType,
      principalId,
      scenario: SCENARIO,
      memberComposition: MEMBER_COMPOSITION,
      submitInstructionProfile: SUBMIT_INSTRUCTION_PROFILE,
      providerKind,
      providerModel,
      definitionHash,
      gitSha: serviceRevision,
      serviceRevision,
      predicateEvidence: {
        oi38: {
          owner_work_id: workId,
          missing_work_id: missingWorkId,
          owner,
          foreign,
          missing,
        },
      },
      client,
      outputRoot,
    });
    process.stdout.write(
      `${JSON.stringify({
        provider: 'real',
        scenario: SCENARIO,
        root_task_id: rootTaskId,
        work_id: workId,
        work_run_id: workRunId,
        recording: capture.directory,
        secret_hits: capture.validation.secret_hits,
        hash_mismatches: capture.validation.hash_mismatches,
      })}\n`,
    );
  } finally {
    if (connected) await client.end();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
)
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
