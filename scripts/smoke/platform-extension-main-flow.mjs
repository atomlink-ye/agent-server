import { randomUUID } from 'node:crypto';
import {
  access,
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const repositoryRoot = resolve(
  fileURLToPath(new URL('../..', import.meta.url)),
);
const adminUrl = process.env.POSTGRES_ADMIN_URL;
const marker = 'PLATFORM_EXTENSION_MVE_OK';
const token = `platform-extension-${randomUUID()}`;
const suffix = `${Date.now()}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
const databaseName = `agent_server_platform_ext_${suffix}`;
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(databaseName))
  throw new Error('stage=configuration error=invalid_database_name');

const runtimeRoot = join(
  repositoryRoot,
  '.local',
  'platform-extension-main-flow',
  `${process.pid}-${randomUUID().slice(0, 8)}`,
);
const projectCwd = join(runtimeRoot, 'project');
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
  process.env.AGENT_SERVER_SKILL_REGISTRY_ROOT = join(
    runtimeRoot,
    'skill-registry',
  );
  process.env.PASEO_WORKSPACE_TITLE = 'Platform Extension Main Flow';
  process.env.SERVICE_ACCOUNTS_JSON = JSON.stringify([
    {
      serviceAccountId: 'svc_platform_extension_smoke',
      token,
      tenantId: 'tenant_platform_extension_smoke',
      workspaceId: 'workspace_platform_extension_smoke',
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
  const workspace = await request(baseUrl, '/api/v1/workspaces', token, {
    method: 'POST',
    body: { name: 'Platform Extension Smoke Workspace' },
    expectedStatus: 201,
  });
  const store = await request(baseUrl, '/api/v1/memory-stores', token, {
    method: 'POST',
    body: { workspace_id: workspace.workspace_id, name: 'platform-extension' },
    expectedStatus: 201,
  });
  await request(
    baseUrl,
    `/api/v1/memory-stores/${store.memory_store.memory_store_id}/memories`,
    token,
    {
      method: 'POST',
      body: { path: 'canary/platform-extension.md', content: marker },
      expectedStatus: 201,
    },
  );
  const imported = await request(baseUrl, '/api/v1/agents:import', token, {
    method: 'POST',
    body: { source: managedAgentYaml() },
    idempotencyKey: `platform-extension-import-${randomUUID()}`,
    expectedStatus: 201,
  });
  const versionId = imported.version?.id;
  if (!versionId) throw new Error('agent_version_missing');
  await request(baseUrl, `/api/v1/agent-versions/${versionId}:publish`, token, {
    method: 'POST',
    body: {},
    idempotencyKey: `platform-extension-publish-${randomUUID()}`,
    expectedStatus: 200,
  });
  const session = await request(baseUrl, '/api/v1/sessions', token, {
    method: 'POST',
    body: {
      workspace_id: workspace.workspace_id,
      agent_version_id: versionId,
    },
    expectedStatus: 201,
  });

  const prompts = [
    `Use the native Skill and authorized platform Memory Tool to read store ${store.memory_store.memory_store_id} at canary/platform-extension.md. Return the exact stored content only.`,
    `Use the native Skill and authorized platform Memory Tool to read store ${store.memory_store.memory_store_id} at canary/platform-extension.md again. Return the exact stored content only.`,
  ];
  if (prompts.some((prompt) => prompt.includes(marker)))
    throw new Error('prompt_marker_leak');
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
        idempotencyKey: `platform-extension-turn-${index}-${randomUUID()}`,
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
    exactOutputs.push(assistant.text === marker);
  }
  if (exactOutputs.length !== 2 || exactOutputs.some((exact) => !exact))
    throw new Error('assistant_exact_output_mismatch');

  stage = 'evidence';
  await evidence.connect();
  const runIds = turns.map((turn) => turn.run_id).filter(Boolean);
  const taskIds = turns.map((turn) => turn.task_id).filter(Boolean);
  if (new Set(runIds).size !== 2 || new Set(taskIds).size !== 2)
    throw new Error('distinct_task_run_ids');
  const runs = await evidence.query(
    'SELECT id,status FROM runs WHERE id = ANY($1::uuid[]) ORDER BY created_at',
    [runIds],
  );
  if (
    runs.rows.length !== 2 ||
    runs.rows.some((row) => row.status !== 'succeeded')
  )
    throw new Error('runs_not_succeeded');
  const bindings = await evidence.query(
    'SELECT run_id,provider_agent_id FROM runtime_session_bindings WHERE run_id = ANY($1::uuid[])',
    [runIds],
  );
  if (
    bindings.rows.length !== 2 ||
    bindings.rows.some((row) => !row.provider_agent_id) ||
    new Set(bindings.rows.map((row) => row.provider_agent_id)).size !== 1
  )
    throw new Error('provider_binding_mismatch');
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
    "SELECT text FROM messages WHERE session_id=$1 AND role='assistant' ORDER BY sequence",
    [session.session_id],
  );
  if (
    messages.rows.length !== 2 ||
    messages.rows.some((row) => row.text !== marker)
  )
    throw new Error('assistant_marker_mismatch');
  const receipts = await readReceipts(
    runtimeRoot,
    workspace.workspace_id,
    session.session_id,
  );
  if (receipts.skill.ref !== 'agent-server/memory-api')
    throw new Error('skill_receipt_scope_mismatch');
  if (
    receipts.grant.workspaceId !== workspace.workspace_id ||
    receipts.grant.productSessionId !== session.session_id ||
    JSON.stringify(receipts.grant.allowedTools) !==
      JSON.stringify(['agent-server/memory-read'])
  )
    throw new Error('grant_receipt_scope_mismatch');
  const authorizationHeaderPersisted = await hasAuthorizationPersistence(
    join(runtimeRoot, 'paseo-home'),
  );
  const result = {
    success: true,
    database_name: databaseName,
    marker,
    turn_count: turns.length,
    distinct_ids: true,
    same_provider_agent: true,
    exact_outputs: exactOutputs,
    event_types: eventTypes,
    receipt_counts: { skill: 1, grant: 1 },
    receipt_evidence: {
      skill: true,
      grant: true,
      workspace_scope: true,
      session_scope: true,
      allowed_tool: true,
    },
    skill_digest_prefix: receipts.skill.digest.slice(0, 12),
    authorization_header_persisted: authorizationHeaderPersisted,
    runtime_state_removed: false,
    paseo_version: await installedVersion('@getpaseo/cli'),
    opencode_version: await installedVersion(
      `opencode-${process.platform}-${process.arch}`,
    ),
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

function managedAgentYaml() {
  return `apiVersion: agent-server/v1alpha1\nkind: ManagedAgent\nmetadata:\n  name: platform-extension-smoke\nspec:\n  description: Platform Extension Smoke\n  instructions: When asked to read Memory, use the authorized platform Tool and return only the Tool content with no label, explanation, quotes, markdown, or punctuation.\n  runtime:\n    provider: paseo\n    modelPolicyRef: free-only\n    mode: isolated\n  tools:\n    - ref: agent-server/memory-read\n      kind: tool\n  skills:\n    - ref: agent-server/memory-api\n  input:\n    schema:\n      type: object\n      properties: {}\n      additionalProperties: false\n    prompt: "Use the authorized memory extension."\n  session:\n    invocation: fresh_per_invocation\n    followUps: queued\n    binding: reusable\n  memory:\n    policy: workspace_snapshot\n    proposalLimit: 0\n  permissions:\n    network: read_only\n    filesystem: workspace_read\n  completion:\n    type: executable\n    command: "done"\n`;
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
  return response.json();
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
    )
      throw new Error('task_or_run_terminal_failure');
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

async function installedVersion(packageName) {
  try {
    const packagePath = join(
      repositoryRoot,
      'node_modules',
      packageName,
      'package.json',
    );
    return JSON.parse(await readFile(packagePath, 'utf8')).version ?? null;
  } catch {
    return null;
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
