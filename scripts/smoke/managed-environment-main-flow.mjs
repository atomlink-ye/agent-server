import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  access,
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const { register: registerTsx } = await import('tsx/esm/api');
registerTsx();

import { serve } from '@hono/node-server';
import { Client } from 'pg';
import {
  getAvailablePort,
  startPaseo,
  stopProcessTree,
  waitForHttp,
} from '../dev/paseo-process.mjs';
import { resolveOpenCodeBinary } from '../dev/resolve-opencode.mjs';
import { resolvePaseoBinary } from '../dev/resolve-paseo.mjs';
import {
  managedAgentYaml,
  managedEnvironmentYaml,
} from '../dev/web-bootstrap-fixtures.mjs';

const repositoryRoot = resolve(
  fileURLToPath(new URL('../..', import.meta.url)),
);
const adminUrl = process.env.POSTGRES_ADMIN_URL;
const marker = 'MANAGED_ENVIRONMENT_MVE_OK';
const token = `managed-environment-${randomUUID()}`;
const workspaceId = randomUUID();
const suffix = `${Date.now()}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
const databaseName = `agent_server_managed_env_${suffix}`;
const nativeSkillBody = await readFile(
  join(repositoryRoot, 'skills', 'agent-server-memory-api', 'SKILL.md'),
  'utf8',
);
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(databaseName))
  throw new Error('stage=configuration error=invalid_database_name');

const runtimeRoot = join(
  repositoryRoot,
  '.local',
  'managed-environment-main-flow',
  `${process.pid}-${randomUUID().slice(0, 8)}`,
);
const projectCwd = join(runtimeRoot, 'project');
const cellRoot = join(runtimeRoot, 'runtime-cells');
const execFileAsync = promisify(execFile);
let admin;
let evidence;
let paseo;
let service;
let apiServer;
let stage = 'initialization';
let cleanupAttempted = false;
let cleanupResult;

try {
  stage = 'database';
  if (!adminUrl) throw new Error('missing_admin_url');
  const parsedAdminUrl = new URL(adminUrl);
  if (!['postgres:', 'postgresql:'].includes(parsedAdminUrl.protocol))
    throw new Error('admin_url_protocol');
  if (!parsedAdminUrl.pathname || parsedAdminUrl.pathname === '/')
    throw new Error('admin_database_missing');
  admin = new Client({ connectionString: adminUrl });
  evidence = new Client({
    connectionString: replaceDatabase(adminUrl, databaseName),
  });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  await mkdir(projectCwd, { recursive: true });

  stage = 'paseo';
  const paseoPort = await getAvailablePort();
  paseo = await startPaseo({
    repositoryRoot,
    runtimeRoot,
    port: paseoPort,
  });

  stage = 'service';
  const apiPort = await getAvailablePort();
  process.env.NODE_ENV = 'test';
  process.env.HOST = '127.0.0.1';
  process.env.PORT = String(apiPort);
  process.env.DATABASE_URL = replaceDatabase(adminUrl, databaseName);
  process.env.POSTGRES_URL = process.env.DATABASE_URL;
  process.env.PASEO_WS_URL = paseo.wsUrl;
  process.env.PASEO_AGENT_CWD = projectCwd;
  process.env.PASEO_RUNTIME_CELL_ROOT = cellRoot;
  process.env.AGENT_SERVER_SKILL_REGISTRY_ROOT = join(
    runtimeRoot,
    'skill-registry',
  );
  process.env.PASEO_WORKSPACE_TITLE = 'Platform Extension Main Flow';
  process.env.SERVICE_ACCOUNTS_JSON = JSON.stringify([
    {
      serviceAccountId: 'svc_managed_environment_smoke',
      token,
      tenantId: 'tenant_managed_environment_smoke',
      workspaceId,
      policyVersion: 'policy-platform-extension-v1',
    },
  ]);
  stage = 'config-import';
  const { loadConfig } = await import('../../src/shared/config.ts');
  stage = 'logger-import';
  const { createLogger } =
    await import('../../src/shared/observability/logger.ts');
  stage = 'bootstrap-import';
  const { createService } = await import('../../src/bootstrap.ts');
  stage = 'config-load';
  const config = loadConfig();
  const logger = createLogger({
    service: config.serviceName,
    minimumLevel: config.logLevel,
    write: () => undefined,
  });
  stage = 'service-create';
  service = await createService(config, logger);
  stage = 'runtime-init';
  await service.runtime.initialize();
  stage = 'api-start';
  apiServer = serve({
    fetch: service.app.fetch,
    hostname: '127.0.0.1',
    port: apiPort,
  });
  const baseUrl = `http://127.0.0.1:${apiPort}`;
  await waitForHttp(`${baseUrl}/health/live`, 30_000);
  await waitForHttp(`${baseUrl}/health/ready`, 90_000);

  stage = 'http-flow';
  stage = 'workspace';
  await evidence.connect();
  await evidence.query(
    'INSERT INTO workspaces(id,tenant_id,principal_type,principal_id,name,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$6)',
    [
      workspaceId,
      'tenant_managed_environment_smoke',
      'service_account',
      'svc_managed_environment_smoke',
      'Managed Environment Smoke Workspace',
      new Date().toISOString(),
    ],
  );
  const workspace = { workspace_id: workspaceId };
  stage = 'store';
  const store = await request(baseUrl, '/api/v1/memory-stores', token, {
    method: 'POST',
    body: { workspace_id: workspace.workspace_id, name: 'managed-environment' },
    expectedStatus: 201,
  });
  stage = 'memory';
  await request(
    baseUrl,
    `/api/v1/memory-stores/${store.memory_store.memory_store_id}/memories`,
    token,
    {
      method: 'POST',
      body: { path: 'canary/managed-environment.md', content: marker },
      expectedStatus: 201,
    },
  );
  stage = 'agent_import';
  const imported = await request(baseUrl, '/api/v1/agents:import', token, {
    method: 'POST',
    body: { source: managedAgentYaml() },
    idempotencyKey: `managed-environment-agent-import-${randomUUID()}`,
    expectedStatus: 201,
  });
  const versionId = imported.version?.id;
  if (!versionId) throw new Error('agent_version_missing');
  stage = 'agent_publish';
  await request(baseUrl, `/api/v1/agent-versions/${versionId}:publish`, token, {
    method: 'POST',
    body: {},
    idempotencyKey: `managed-environment-agent-publish-${randomUUID()}`,
    expectedStatus: 200,
  });
  const environmentYaml = managedEnvironmentYaml();
  stage = 'env_validate';
  const validation = await request(
    baseUrl,
    '/api/v1/environment-packages:validate',
    token,
    { method: 'POST', body: { source: environmentYaml }, expectedStatus: 200 },
  );
  if (!validation.valid) throw new Error('environment_validation_failed');
  stage = 'env_import';
  const environmentImported = await request(
    baseUrl,
    '/api/v1/environments:import',
    token,
    {
      method: 'POST',
      body: { source: environmentYaml },
      idempotencyKey: `managed-environment-import-${randomUUID()}`,
      expectedStatus: 201,
    },
  );
  const environmentVersionId = environmentImported.version?.id;
  if (!environmentVersionId) throw new Error('environment_version_missing');
  stage = 'env_read';
  const environmentRead = await request(
    baseUrl,
    `/api/v1/environment-versions/${environmentVersionId}`,
    token,
    { method: 'GET', expectedStatus: 200 },
  );
  if (
    environmentRead.id !== environmentVersionId ||
    environmentRead.status !== 'draft'
  )
    throw new Error('environment_read_mismatch');
  stage = 'env_publish';
  await request(
    baseUrl,
    `/api/v1/environment-versions/${environmentVersionId}:publish`,
    token,
    {
      method: 'POST',
      body: {},
      idempotencyKey: `managed-environment-publish-${randomUUID()}`,
      expectedStatus: 200,
    },
  );
  stage = 'session_a';
  const prompts = [
    `Use the native Skill and authorized platform Memory Tool to read store ${store.memory_store.memory_store_id} at canary/managed-environment.md. Return the exact stored content only.`,
    `Use the native Skill and authorized platform Memory Tool to read store ${store.memory_store.memory_store_id} at canary/managed-environment.md again. Return the exact stored content only.`,
  ];
  const promptB = `Use the native Skill and authorized platform Memory Tool to read store ${store.memory_store.memory_store_id} at canary/managed-environment.md. Return the exact stored content only.`;
  if ([...prompts, promptB].some((prompt) => prompt.includes(marker)))
    throw new Error('prompt_marker_leak');
  const session = await request(baseUrl, '/api/v1/sessions', token, {
    method: 'POST',
    body: {
      workspace_id: workspace.workspace_id,
      agent_version_id: versionId,
      environment_version_id: environmentVersionId,
    },
    expectedStatus: 201,
  });
  if (session.environment_version_id !== environmentVersionId)
    throw new Error('session_a_environment_pin_missing');
  stage = 'session_a_created';
  const turns = [];
  const exactOutputs = [];
  for (let index = 0; index < prompts.length; index += 1) {
    const turn = await request(
      baseUrl,
      `/api/v1/sessions/${session.session_id}/messages`,
      token,
      {
        method: 'POST',
        body: { text: prompts[index] },
        idempotencyKey: `managed-environment-turn-${index}-${randomUUID()}`,
        expectedStatus: 202,
      },
    );
    turns.push(turn);
    const assistant = await waitForAssistant(
      baseUrl,
      session.session_id,
      token,
      turn,
      index + 1,
    );
    exactOutputs.push(
      assistant.text === marker || assistant.text.includes(marker),
    );
  }
  stage = 'session_b';
  const sessionB = await request(baseUrl, '/api/v1/sessions', token, {
    method: 'POST',
    body: {
      workspace_id: workspace.workspace_id,
      agent_version_id: versionId,
      environment_version_id: environmentVersionId,
    },
    expectedStatus: 201,
  });
  if (sessionB.environment_version_id !== environmentVersionId)
    throw new Error('session_b_environment_pin_missing');
  const turnB = await request(
    baseUrl,
    `/api/v1/sessions/${sessionB.session_id}/messages`,
    token,
    {
      method: 'POST',
      body: { text: promptB },
      idempotencyKey: `managed-environment-turn-b-${randomUUID()}`,
      expectedStatus: 202,
    },
  );
  const assistantB = await waitForAssistant(
    baseUrl,
    sessionB.session_id,
    token,
    turnB,
    1,
  );
  if (
    exactOutputs.length !== 2 ||
    exactOutputs.some((exact) => !exact) ||
    !assistantB.text.includes(marker)
  )
    throw new Error('assistant_marker_mismatch');

  stage = 'evidence';
  const allTurns = [...turns, turnB];
  const runIds = allTurns.map((turn) => turn.run_id).filter(Boolean);
  const taskIds = allTurns.map((turn) => turn.task_id).filter(Boolean);
  if (new Set(runIds).size !== 3 || new Set(taskIds).size !== 3)
    throw new Error('distinct_task_run_ids');
  const runs = await evidence.query(
    'SELECT id,status FROM runs WHERE id = ANY($1::uuid[]) ORDER BY created_at',
    [runIds],
  );
  if (
    runs.rows.length !== 3 ||
    runs.rows.some((row) => row.status !== 'succeeded')
  )
    throw new Error('runs_not_succeeded');
  const bindings = await evidence.query(
    'SELECT run_id,provider_agent_id FROM runtime_session_bindings WHERE run_id = ANY($1::uuid[])',
    [runIds],
  );
  if (
    bindings.rows.length !== 3 ||
    bindings.rows.some((row) => !row.provider_agent_id) ||
    new Set(bindings.rows.map((row) => row.run_id)).size !== 3 ||
    new Set(bindings.rows.map((row) => row.provider_agent_id)).size !== 2
  )
    throw new Error('provider_binding_mismatch');
  const bindingByRun = new Map(
    bindings.rows.map((row) => [row.run_id, row.provider_agent_id]),
  );
  const providerA1 = bindingByRun.get(turns[0].run_id);
  const providerA2 = bindingByRun.get(turns[1].run_id);
  const providerB1 = bindingByRun.get(turnB.run_id);
  if (
    !providerA1 ||
    providerA1 !== providerA2 ||
    !providerB1 ||
    providerB1 === providerA1
  )
    throw new Error('provider_binding_partition_mismatch');
  const events = await evidence.query(
    'SELECT run_id,type FROM run_events WHERE run_id = ANY($1::uuid[]) ORDER BY run_id,sequence',
    [runIds],
  );
  const eventTypes = [...new Set(events.rows.map((row) => row.type))];
  for (const runId of runIds) {
    const actual = events.rows
      .filter((row) => row.run_id === runId)
      .map((row) => row.type);
    if (actual.join(',') !== 'started,output,succeeded')
      throw new Error('event_sequence_mismatch');
  }
  const messages = await evidence.query(
    "SELECT text FROM messages WHERE session_id = ANY($1::uuid[]) AND role='assistant' ORDER BY sequence",
    [[session.session_id, sessionB.session_id]],
  );
  if (
    messages.rows.length !== 3 ||
    messages.rows.some(
      (row) => typeof row.text !== 'string' || !row.text.includes(marker),
    )
  )
    throw new Error('assistant_marker_mismatch');
  const productSessions = await evidence.query(
    'SELECT id,published_environment_version_id FROM product_sessions WHERE id = ANY($1::uuid[])',
    [[session.session_id, sessionB.session_id]],
  );
  if (
    productSessions.rows.length !== 2 ||
    productSessions.rows.some(
      (row) => row.published_environment_version_id !== environmentVersionId,
    )
  )
    throw new Error('product_session_environment_pin_mismatch');
  const runtimeSessions = await evidence.query(
    "SELECT rs.id,rs.product_session_id AS scope_id,rs.launch_snapshot_id,rs.paseo_workspace_id,rs.provider_agent_id,sls.environment_version_id FROM runtime_sessions rs JOIN session_launch_snapshots sls ON sls.id=rs.launch_snapshot_id WHERE rs.scope_kind='product_session' AND rs.product_session_id = ANY($1::uuid[])",
    [[session.session_id, sessionB.session_id]],
  );
  if (runtimeSessions.rows.length !== 2)
    throw new Error('runtime_session_count_mismatch');
  const runtimeSnapshotIds = runtimeSessions.rows.map(
    (row) => row.launch_snapshot_id,
  );
  const snapshots = await evidence.query(
    "SELECT id,environment_version_id FROM session_launch_snapshots WHERE tenant_id=$1 AND principal_type='service_account' AND principal_id=$2",
    ['tenant_managed_environment_smoke', 'svc_managed_environment_smoke'],
  );
  if (
    snapshots.rows.length !== 2 ||
    new Set(snapshots.rows.map((row) => row.id)).size !== 2 ||
    new Set(snapshots.rows.map((row) => row.id)).size !==
      new Set(runtimeSnapshotIds).size ||
    snapshots.rows.some((row) => !runtimeSnapshotIds.includes(row.id)) ||
    snapshots.rows.some(
      (row) => row.environment_version_id !== environmentVersionId,
    )
  )
    throw new Error('launch_snapshot_pin_mismatch');
  const runtimeA = runtimeSessions.rows.find(
    (row) => row.scope_id === session.session_id,
  );
  const runtimeB = runtimeSessions.rows.find(
    (row) => row.scope_id === sessionB.session_id,
  );
  const bindingPredicates = {
    runtime_a_found: Boolean(runtimeA),
    runtime_b_found: Boolean(runtimeB),
    provider_a_present: Boolean(runtimeA?.provider_agent_id),
    provider_b_present: Boolean(runtimeB?.provider_agent_id),
    workspace_a_present: Boolean(runtimeA?.paseo_workspace_id),
    workspace_b_present: Boolean(runtimeB?.paseo_workspace_id),
    environment_a_matches:
      runtimeA?.environment_version_id === environmentVersionId,
    environment_b_matches:
      runtimeB?.environment_version_id === environmentVersionId,
    runtime_ids_distinct: Boolean(
      runtimeA && runtimeB && runtimeA.id !== runtimeB.id,
    ),
    provider_ids_distinct: Boolean(
      runtimeA?.provider_agent_id &&
      runtimeB?.provider_agent_id &&
      runtimeA.provider_agent_id !== runtimeB.provider_agent_id,
    ),
    workspace_ids_distinct: Boolean(
      runtimeA?.paseo_workspace_id &&
      runtimeB?.paseo_workspace_id &&
      runtimeA.paseo_workspace_id !== runtimeB.paseo_workspace_id,
    ),
  };
  const failedBindingPredicates = Object.entries(bindingPredicates)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (failedBindingPredicates.length)
    throw new Error(
      `runtime_session_binding_mismatch_${failedBindingPredicates.join('_')}`,
    );
  if (
    new Set(
      bindings.rows
        .filter((row) => runIds.slice(0, 2).includes(row.run_id))
        .map((row) => row.provider_agent_id),
    ).size !== 1 ||
    providerB1 === providerA1
  )
    throw new Error('provider_agent_session_mismatch');
  const cellEvidenceA = await inspectCell(
    join(cellRoot, runtimeA.id),
    join(runtimeRoot, 'skill-registry'),
    workspace.workspace_id,
    session.session_id,
  );
  const cellEvidenceB = await inspectCell(
    join(cellRoot, runtimeB.id),
    join(runtimeRoot, 'skill-registry'),
    workspace.workspace_id,
    sessionB.session_id,
  );
  if (!cellEvidenceA.valid || !cellEvidenceB.valid)
    throw new Error('cell_projection_or_receipt_mismatch');
  const providerEvidenceA = await inspectProviderRecord(
    join(runtimeRoot, 'paseo-home'),
    providerA1,
    marker,
    'MEMORY_API_SKILL_V1',
    nativeSkillBody,
  );
  const providerEvidenceB = await inspectProviderRecord(
    join(runtimeRoot, 'paseo-home'),
    providerB1,
    marker,
    'MEMORY_API_SKILL_V1',
    nativeSkillBody,
  );
  if (!providerEvidenceA.valid || !providerEvidenceB.valid)
    throw new Error('provider_system_prompt_projection_mismatch');
  const authorizationHeaderPersisted = await hasAuthorizationPersistence(
    join(runtimeRoot, 'paseo-home'),
  );
  const result = {
    success: true,
    database_name: databaseName,
    marker,
    turn_count: 3,
    distinct_ids: true,
    same_provider_agent: providerA1 === providerA2,
    exact_outputs: [
      ...exactOutputs,
      assistantB.text === marker || assistantB.text.includes(marker),
    ],
    provider_workspace_reuse: Boolean(
      runtimeA.paseo_workspace_id && providerA1 === providerA2,
    ),
    provider_workspace_distinct:
      runtimeA.paseo_workspace_id !== runtimeB.paseo_workspace_id,
    provider_distinct: providerA1 !== providerB1,
    two_cells:
      cellEvidenceA.valid && cellEvidenceB.valid && runtimeA.id !== runtimeB.id,
    cell_projection_receipts: {
      a: {
        projection: cellEvidenceA.projection,
        skill_receipts: cellEvidenceA.skillReceipts,
        grant_receipts: cellEvidenceA.grantReceipts,
      },
      b: {
        projection: cellEvidenceB.projection,
        skill_receipts: cellEvidenceB.skillReceipts,
        grant_receipts: cellEvidenceB.grantReceipts,
      },
    },
    event_types: eventTypes,
    receipt_counts: {
      a: {
        skill: cellEvidenceA.skillReceipts,
        grant: cellEvidenceA.grantReceipts,
      },
      b: {
        skill: cellEvidenceB.skillReceipts,
        grant: cellEvidenceB.grantReceipts,
      },
    },
    provider_system_prompt_checks: {
      a: providerEvidenceA.valid,
      b: providerEvidenceB.valid,
    },
    authorization_header_persisted: authorizationHeaderPersisted,
    runtime_state_removed: false,
    paseo_version: await installedVersion('paseo'),
    opencode_version: await installedVersion('opencode'),
  };
  cleanupResult = await cleanup({ retainDatabase: true });
  result.runtime_state_removed = cleanupResult.runtimeStateRemoved;
  if (!cleanupResult.success) throw new Error('runtime_cleanup_incomplete');
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  if (!cleanupAttempted)
    cleanupResult = await cleanup({ retainDatabase: false });
  const errorCode = safeErrorCode(error);
  const errorName = errorCode;
  const runtimeStateRemoved = cleanupResult?.runtimeStateRemoved ?? false;
  process.stderr.write(
    `${JSON.stringify({
      success: false,
      database_name: databaseName,
      stage,
      error_name: errorName,
      runtime_state_removed: runtimeStateRemoved,
    })}\n`,
  );
  process.stderr.write(
    `${JSON.stringify({ cleanup_failures: cleanupResult?.failures ?? [] })}\n`,
  );
  process.exitCode = 1;
}

function replaceDatabase(value, database) {
  const url = new URL(value);
  url.pathname = `/${database}`;
  return url.toString();
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function request(baseUrl, path, bearer, options) {
  const headers = {
    authorization: `Bearer ${bearer}`,
    'content-type': 'application/json',
    ...(options.idempotencyKey
      ? { 'idempotency-key': options.idempotencyKey }
      : {}),
  };
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method,
    headers,
    body: JSON.stringify(options.body),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status !== options.expectedStatus) {
    const error = new Error('http_status');
    error.name = `HttpStatus${response.status}`;
    throw error;
  }
  try {
    return await response.json();
  } catch {
    const error = new Error('invalid_json');
    error.name = `HttpStatus${response.status}_invalid_json`;
    throw error;
  }
}

async function waitForAssistant(baseUrl, sessionId, bearer, turn, count) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const task = await request(
      baseUrl,
      `/api/v1/tasks/${turn.task_id}`,
      bearer,
      {
        method: 'GET',
        expectedStatus: 200,
      },
    );
    const run = await request(baseUrl, `/api/v1/runs/${turn.run_id}`, bearer, {
      method: 'GET',
      expectedStatus: 200,
    });
    const response = await request(
      baseUrl,
      `/api/v1/sessions/${sessionId}/messages`,
      bearer,
      { method: 'GET', expectedStatus: 200 },
    );
    const assistants = (response.messages ?? []).filter(
      (message) => message.role === 'assistant',
    );
    if (
      task.status === 'completed' &&
      run.status === 'succeeded' &&
      assistants.length >= count
    ) {
      if (!assistants[count - 1]?.text.includes(marker))
        throw new Error('assistant_marker_mismatch');
      return assistants[count - 1];
    }
    if (
      ['failed', 'cancelled', 'timed_out'].includes(task.status) ||
      ['failed', 'cancelled', 'timed_out'].includes(run.status)
    ) {
      const failureCode =
        typeof run.error?.code === 'string' &&
        /^[A-Za-z0-9_.-]+$/.test(run.error.code)
          ? run.error.code
          : 'none';
      throw new Error(
        `terminal_task_${task.status}_run_${run.status}_failure_${failureCode}`,
      );
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error('assistant_timeout');
}

async function readReceipts(root, workspaceId, sessionId) {
  const files = await listFiles(join(root, 'skill-receipts'));
  const skillFiles = files.filter((path) => !path.includes('/grants/'));
  const grantFiles = files.filter((path) => path.includes('/grants/'));
  if (skillFiles.length !== 1 || grantFiles.length !== 1)
    throw new Error('receipt_count_mismatch');
  const skill = await readReceipt(
    skillFiles[0],
    {
      format: 1,
      ref: 'agent-server/memory-api',
      delivery: 'native_project',
    },
    ['format', 'ref', 'digest', 'delivery'],
  );
  if (!/^[0-9a-f]{64}$/.test(skill.digest))
    throw new Error('skill_receipt_digest_mismatch');
  const grant = await readReceipt(
    grantFiles[0],
    {
      grantId: grantFiles[0].split('/').pop().replace('.json', ''),
      workspaceId,
      productSessionId: sessionId,
      allowedTools: ['agent-server/memory-read'],
      expiresAt: undefined,
    },
    ['grantId', 'workspaceId', 'productSessionId', 'allowedTools', 'expiresAt'],
  );
  if (
    !/^[0-9a-f-]{36}$/.test(grant.grantId) ||
    !Number.isFinite(Date.parse(grant.expiresAt))
  )
    throw new Error('grant_receipt_expiry_mismatch');
  return { skill, grant };
}

async function inspectCell(root, registryRoot, workspaceId, sessionId) {
  const projection = join(
    root,
    '.agents',
    'skills',
    'agent-server',
    'memory-api',
  );
  const receiptsRoot = join(root, 'skill-receipts');
  const files = await listFiles(receiptsRoot);
  const skillFiles = files.filter((path) => !path.includes('/grants/'));
  const grantFiles = files.filter((path) => path.includes('/grants/'));
  if (skillFiles.length !== 1 || grantFiles.length !== 1)
    return {
      valid: false,
      projection: false,
      skillReceipts: skillFiles.length,
      grantReceipts: grantFiles.length,
    };
  const projectionStat = await lstat(projection).catch(() => null);
  const projectionTarget = projectionStat?.isSymbolicLink()
    ? await realpath(projection).catch(() => null)
    : null;
  const skill = await readReceipt(
    skillFiles[0],
    { format: 1, ref: 'agent-server/memory-api', delivery: 'native_project' },
    ['format', 'ref', 'digest', 'delivery'],
  );
  const grant = await readReceipt(
    grantFiles[0],
    {
      grantId: grantFiles[0].split('/').pop().replace('.json', ''),
      workspaceId,
      productSessionId: sessionId,
      allowedTools: ['agent-server/memory-read'],
      expiresAt: undefined,
    },
    ['grantId', 'workspaceId', 'productSessionId', 'allowedTools', 'expiresAt'],
  );
  return {
    valid:
      Boolean(
        projectionTarget &&
        (await realpathWithin(registryRoot, projectionTarget)) &&
        projectionTarget.split('/').at(-1) === skill.digest,
      ) &&
      /^[0-9a-f]{64}$/.test(skill.digest) &&
      /^[0-9a-f-]{36}$/.test(grant.grantId) &&
      Number.isFinite(Date.parse(grant.expiresAt)),
    projection: Boolean(
      projectionTarget &&
      (await realpathWithin(registryRoot, projectionTarget)) &&
      projectionTarget.split('/').at(-1) === skill.digest,
    ),
    skillReceipts: skillFiles.length,
    grantReceipts: grantFiles.length,
    digest: skill.digest,
  };
}

async function realpathWithin(root, path) {
  try {
    const resolved = await realpath(path);
    const base = await realpath(root);
    return resolved.startsWith(`${base}/`);
  } catch {
    return false;
  }
}

async function inspectProviderRecord(
  root,
  providerAgentId,
  markerValue,
  hiddenSkillMarker,
  skillBody,
) {
  const files = await listFiles(root);
  const candidates = [];
  for (const path of files) {
    const content = await readFile(path, 'utf8').catch(() => null);
    if (!content || content.length > 2 * 1024 * 1024) continue;
    for (const document of parseStructuredDocuments(content))
      findProviderRecords(document, providerAgentId, 0, candidates);
  }
  const identified = candidates.find(
    (candidate) => candidate.id === providerAgentId,
  );
  const systemPrompt = identified?.config?.systemPrompt;
  return {
    valid: Boolean(
      identified &&
      typeof systemPrompt === 'string' &&
      !systemPrompt.includes(markerValue) &&
      !systemPrompt.includes(hiddenSkillMarker) &&
      !systemPrompt.includes(skillBody),
    ),
  };
}

function parseStructuredDocuments(content) {
  try {
    return [JSON.parse(content)];
  } catch {
    return content
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
  }
}

function findProviderRecords(value, providerAgentId, depth, found) {
  if (depth > 8 || !value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const child of value)
      findProviderRecords(child, providerAgentId, depth + 1, found);
    return;
  }
  if (value.id === providerAgentId) found.push(value);
  for (const child of Object.values(value))
    findProviderRecords(child, providerAgentId, depth + 1, found);
}

async function readReceipt(path, expectedFields, expectedKeys) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o444)
    throw new Error('receipt_file_mode_mismatch');
  const value = JSON.parse(await readFile(path, 'utf8'));
  if (!sameKeys(value, expectedKeys))
    throw new Error('receipt_fields_mismatch');
  for (const [key, expected] of Object.entries(expectedFields)) {
    if (
      expected !== undefined &&
      JSON.stringify(value[key]) !== JSON.stringify(expected)
    )
      throw new Error('receipt_value_mismatch');
  }
  return value;
}

function sameKeys(value, keys) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

async function listFiles(root) {
  const found = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(
      () => [],
    )) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) found.push(path);
    }
  }
  await visit(root);
  return found;
}

async function hasAuthorizationPersistence(root) {
  for (const path of await listFiles(root)) {
    try {
      const content = await readFile(path, 'utf8');
      if (
        /["']?authorization["']?\s*[:=]/i.test(content) ||
        /["']?bearer["']?\s*[:=]/i.test(content)
      )
        return true;
    } catch {
      // Isolated runtime files may disappear while Paseo exits.
    }
  }
  return false;
}

async function installedVersion(provider) {
  const binary =
    provider === 'paseo'
      ? await resolvePaseoBinary()
      : await resolveOpenCodeBinary();
  try {
    const { stdout } = await execFileAsync(binary, ['--version'], {
      encoding: 'utf8',
    });
    const version = stdout.trim();
    if (!version) throw new Error(`${provider}_version_empty`);
    return version;
  } catch (error) {
    if (Number.isInteger(error?.code) && error.code !== 0) {
      const code = `${provider}_version_exit_${error.code}`;
      throw Object.assign(new Error(code), { code });
    }
    if (error?.signal) {
      const code = `${provider}_version_signal_${error.signal}`;
      throw Object.assign(new Error(code), { code });
    }
    throw error;
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function cleanup({ retainDatabase }) {
  cleanupAttempted = true;
  const failures = [];
  await attemptCleanup(
    'api_server',
    async () => {
      if (apiServer)
        await new Promise((resolveClose, rejectClose) =>
          apiServer.close((error) =>
            error ? rejectClose(error) : resolveClose(),
          ),
        );
    },
    failures,
  );
  await attemptCleanup('service', () => service?.close(), failures);
  await attemptCleanup(
    'paseo_process',
    () => stopProcessTree(paseo?.child),
    failures,
  );
  await attemptCleanup('evidence_connection', () => evidence?.end(), failures);
  await attemptCleanup('admin_connection', () => admin?.end(), failures);
  await attemptCleanup(
    'runtime_root',
    async () => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await makeRemovable(runtimeRoot);
        try {
          await rm(runtimeRoot, { recursive: true, force: true });
          if (!(await exists(runtimeRoot))) return;
        } catch (error) {
          if (!['ENOTEMPTY', 'EBUSY', 'EPERM'].includes(error?.code))
            throw error;
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
      }
      if (await exists(runtimeRoot)) throw new Error('root_remains');
    },
    failures,
  );
  if (failures.length === 0 && retainDatabase) {
    return { success: true, runtimeStateRemoved: true, failures };
  }
  if (adminUrl) {
    const dropClient = new Client({ connectionString: adminUrl });
    try {
      await dropClient.connect();
      await dropClient.query(
        `DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`,
      );
    } catch {
      failures.push('database_drop');
    } finally {
      await dropClient.end().catch(() => undefined);
    }
  }
  return {
    success: false,
    runtimeStateRemoved: !(await exists(runtimeRoot)),
    failures,
  };
}

async function attemptCleanup(label, operation, failures) {
  try {
    await operation();
  } catch {
    failures.push(label);
  }
}

function safeErrorCode(error) {
  if (error?.message && /^[A-Za-z0-9_.:-]+$/.test(error.message))
    return error.message;
  const missing =
    typeof error?.message === 'string'
      ? error.message.match(
          /(?:ReferenceError:\s*)?([A-Za-z_$][\w$]*) is not defined/,
        )
      : null;
  if (missing) return `undefined_${missing[1]}`;
  return error?.code && /^[A-Za-z0-9_.-]+$/.test(error.code)
    ? error.code
    : error?.name && /^[A-Za-z0-9_.-]+$/.test(error.name)
      ? error.name
      : 'smoke_failure';
}

async function makeRemovable(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  )) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await makeRemovable(path);
    else await chmod(path, 0o644).catch(() => undefined);
  }
  await chmod(directory, 0o755).catch(() => undefined);
}
