import { createHash, randomUUID } from 'node:crypto';
import {
  access,
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, relative, resolve, sep } from 'node:path';
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
const marker = 'USER_AUTHORED_SKILL_V1_OK';
const token = `user-skill-${randomUUID()}`;
const databaseName = `agent_server_user_skill_${Date.now()}_${randomUUID()
  .replaceAll('-', '')
  .slice(0, 8)}`;
const runtimeRoot = join(
  repositoryRoot,
  '.local',
  'user-authored-skill-main-flow',
  `${process.pid}-${randomUUID()}`,
);
const projectRoot = join(runtimeRoot, 'project');
const registryRoot = join(runtimeRoot, 'skill-registry');
const skillRoot = join(projectRoot, 'skills', 'market-guide');
const agentCwd = projectRoot;
let admin;
let evidence;
let paseo;
let service;
let apiServer;
let stage = 'initialization';
let cleanupAttempted = false;
let cleanupResult;

try {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(databaseName))
    throw new Error('invalid_database_name');
  if (!adminUrl) throw new Error('missing_admin_url');
  const parsedAdminUrl = new URL(adminUrl);
  if (!['postgres:', 'postgresql:'].includes(parsedAdminUrl.protocol))
    throw new Error('admin_url_protocol');
  if (!parsedAdminUrl.pathname || parsedAdminUrl.pathname === '/')
    throw new Error('admin_database_missing');

  stage = 'database';
  admin = new Client({ connectionString: adminUrl });
  evidence = new Client({
    connectionString: replaceDatabase(adminUrl, databaseName),
  });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  await mkdir(skillRoot, { recursive: true });
  await writeFile(join(projectRoot, 'agent.yaml'), managedAgentYaml(), {
    mode: 0o644,
  });
  await writeFile(join(skillRoot, 'SKILL.md'), skillBody(), { mode: 0o644 });

  stage = 'registration';
  const first = await registerProject();
  const second = await registerProject();
  const firstRegistration = first.registered?.[0];
  const secondRegistration = second.registered?.[0];
  if (
    firstRegistration?.ref !== 'project/research-agent/market-guide' ||
    firstRegistration.changed !== true ||
    secondRegistration?.ref !== firstRegistration.ref ||
    secondRegistration.digest !== firstRegistration.digest ||
    secondRegistration.changed !== false
  )
    throw new Error('registration_idempotency_mismatch');
  const digest = firstRegistration.digest;

  stage = 'paseo';
  paseo = await startPaseo({
    repositoryRoot,
    runtimeRoot,
    port: await getAvailablePort(),
  });

  stage = 'service';
  const apiPort = await getAvailablePort();
  process.env.NODE_ENV = 'test';
  process.env.HOST = '127.0.0.1';
  process.env.PORT = String(apiPort);
  process.env.DATABASE_URL = replaceDatabase(adminUrl, databaseName);
  process.env.POSTGRES_URL = process.env.DATABASE_URL;
  process.env.PASEO_WS_URL = paseo.wsUrl;
  process.env.PASEO_AGENT_CWD = agentCwd;
  process.env.AGENT_SERVER_SKILL_REGISTRY_ROOT = registryRoot;
  process.env.PASEO_WORKSPACE_TITLE = 'User Authored Skill Smoke';
  process.env.SERVICE_ACCOUNTS_JSON = JSON.stringify([
    {
      serviceAccountId: 'svc_user_authored_skill_smoke',
      token,
      tenantId: 'tenant_user_authored_skill_smoke',
      workspaceId: 'workspace_user_authored_skill_smoke',
      policyVersion: 'policy-user-authored-skill-v1',
    },
  ]);
  const { loadConfig } = await import('../../src/shared/config.ts');
  const { createLogger } =
    await import('../../src/shared/observability/logger.ts');
  const { createService } = await import('../../src/bootstrap.ts');
  const config = loadConfig();
  const logger = createLogger({
    service: config.serviceName,
    minimumLevel: config.logLevel,
    write: () => undefined,
  });
  service = await createService(config, logger);
  await service.runtime.initialize();
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
    body: { name: 'User Authored Skill Smoke Workspace' },
    expectedStatus: 201,
  });
  const imported = await request(baseUrl, '/api/v1/agents:import', token, {
    method: 'POST',
    body: { source: managedAgentYaml() },
    idempotencyKey: `user-skill-import-${randomUUID()}`,
    expectedStatus: 201,
  });
  const versionId = imported.version?.id;
  if (!versionId) throw new Error('agent_version_missing');
  await request(baseUrl, `/api/v1/agent-versions/${versionId}:publish`, token, {
    method: 'POST',
    body: {},
    idempotencyKey: `user-skill-publish-${randomUUID()}`,
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
  const prompt =
    'Use the native market-guide Skill and return its current guidance marker exactly.';
  if (prompt.includes(marker) || managedAgentYaml().includes(marker))
    throw new Error('marker_prompt_leak');
  const markerAbsentFromSubmittedUserPrompt = !prompt.includes(marker);
  const turn = await request(
    baseUrl,
    `/api/v1/sessions/${session.session_id}/messages`,
    token,
    {
      method: 'POST',
      body: { text: prompt },
      idempotencyKey: `user-skill-turn-${randomUUID()}`,
      expectedStatus: 202,
    },
  );
  const assistant = await waitForAssistant(
    baseUrl,
    session.session_id,
    token,
    turn,
  );
  if (assistant.text !== marker)
    throw new Error('assistant_exact_output_mismatch');

  stage = 'evidence';
  await evidence.connect();
  const runIds = [turn.run_id].filter(Boolean);
  const taskIds = [turn.task_id].filter(Boolean);
  if (runIds.length !== 1 || taskIds.length !== 1)
    throw new Error('task_run_id_missing');
  const runs = await evidence.query('SELECT status FROM runs WHERE id = $1', [
    runIds[0],
  ]);
  if (runs.rows.length !== 1 || runs.rows[0].status !== 'succeeded')
    throw new Error('run_not_succeeded');
  const events = await evidence.query(
    'SELECT type FROM run_events WHERE run_id = $1 ORDER BY sequence',
    [runIds[0]],
  );
  if (
    events.rows.map((row) => row.type).join(',') !== 'started,output,succeeded'
  )
    throw new Error('event_sequence_mismatch');
  const messages = await evidence.query(
    'SELECT role,text FROM messages WHERE session_id=$1 ORDER BY sequence',
    [session.session_id],
  );
  const assistantRows = messages.rows.filter((row) => row.role === 'assistant');
  const userRows = messages.rows.filter((row) => row.role === 'user');
  if (
    userRows.length !== 1 ||
    assistantRows.length !== 1 ||
    assistantRows[0].text !== marker
  )
    throw new Error('durable_message_mismatch');
  const bindings = await evidence.query(
    'SELECT provider_agent_id FROM runtime_session_bindings WHERE run_id = $1',
    [runIds[0]],
  );
  if (bindings.rows.length !== 1 || !bindings.rows[0].provider_agent_id)
    throw new Error('provider_binding_missing');
  const providerAgentId = bindings.rows[0].provider_agent_id;

  const projection = join(
    projectRoot,
    '.agents',
    'skills',
    'project',
    'research-agent',
    'market-guide',
  );
  const projectionStat = await lstat(projection);
  const projectionRealPath = await realpath(projection);
  const objectRealPath = await realpath(join(registryRoot, 'objects', digest));
  const receipts = await readReceipts(runtimeRoot, digest);
  const registryEvidence = await inspectRegistry(registryRoot, digest);
  if (
    !projectionStat.isSymbolicLink() ||
    projectionRealPath !== objectRealPath ||
    !projectionRealPath.startsWith(`${await realpath(registryRoot)}/`) ||
    receipts.skill !== 1 ||
    receipts.grant !== 0
  )
    throw new Error('skill_projection_or_receipt_mismatch');
  const providerEvidence = await inspectProviderRecord(
    join(runtimeRoot, 'paseo-home'),
    providerAgentId,
    marker,
  );
  if (
    !providerEvidence.providerRecordFound ||
    !providerEvidence.markerAbsentFromProviderSystemPrompt ||
    !markerAbsentFromSubmittedUserPrompt ||
    providerEvidence.mcpConfigPersisted
  )
    throw new Error('mcp_config_persisted');

  const result = {
    success: true,
    database_name: databaseName,
    marker,
    registration_changed_first: true,
    registration_changed_second: false,
    registration_same_digest: true,
    turn_count: 1,
    exact_output: true,
    event_types: events.rows.map((row) => row.type),
    provider_agent_present: true,
    custom_skill_receipts: 1,
    grant_receipts: 0,
    projection_is_symlink: true,
    projection_under_registry: true,
    provider_record_found: providerEvidence.providerRecordFound,
    marker_absent_from_provider_system_prompt:
      providerEvidence.markerAbsentFromProviderSystemPrompt,
    marker_absent_from_submitted_user_prompt:
      markerAbsentFromSubmittedUserPrompt,
    mcp_config_persisted: providerEvidence.mcpConfigPersisted,
    logical_manifest_valid: registryEvidence.logicalManifestValid,
    object_manifest_valid: registryEvidence.objectManifestValid,
    files_digest_valid: registryEvidence.filesDigestValid,
    digest_prefix: digest.slice(0, 12),
    runtime_state_removed: false,
    paseo_version: await installedVersion(['@getpaseo/cli']),
    opencode_version: await installedVersion([
      `opencode-${process.platform}-${process.arch}`,
      'opencode',
    ]),
  };
  cleanupResult = await cleanup({ retainDatabase: true });
  result.runtime_state_removed = cleanupResult.runtimeStateRemoved;
  if (!cleanupResult.success) throw new Error('cleanup_failed');
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  if (!cleanupAttempted)
    cleanupResult = await cleanup({ retainDatabase: false });
  process.stderr.write(
    `${JSON.stringify({ success: false, database_name: databaseName, stage, error_code: safeErrorCode(error), runtime_state_removed: cleanupResult?.runtimeStateRemoved ?? false, cleanup_failures: cleanupResult?.failures ?? [] })}\n`,
  );
  process.exitCode = 1;
}

async function registerProject() {
  const result = await spawnCapture(
    'pnpm',
    ['skill:register', '--', '--project', projectRoot],
    {
      ...process.env,
      AGENT_SERVER_SKILL_REGISTRY_ROOT: registryRoot,
    },
  );
  const line = result.stdout
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean)
    .at(-1);
  if (!line) throw new Error('registration_output_missing');
  const parsed = JSON.parse(line);
  if (result.code !== 0 || !Array.isArray(parsed.registered))
    throw new Error('registration_failed');
  return parsed;
}

function spawnCapture(command, args, env) {
  return new Promise((resolveCapture, rejectCapture) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.once('error', rejectCapture);
    child.once('close', (code) => resolveCapture({ stdout, code }));
  });
}

function managedAgentYaml() {
  return `apiVersion: agent-server/v1alpha1
kind: ManagedAgent
metadata:
  name: research-agent
spec:
  description: Research agent with a local market guide
  instructions: When asked for market guidance, use the native market-guide Skill and return only its guidance, with no label or explanation.
  runtime:
    provider: paseo
    modelPolicyRef: free-only
    mode: isolated
  tools: []
  skills:
    - ref: project/research-agent/market-guide
  input:
    schema:
      type: object
      properties: {}
      additionalProperties: false
    prompt: "Use the native market guide."
  session:
    invocation: fresh_per_invocation
    followUps: queued
    binding: reusable
  memory:
    policy: workspace_snapshot
    proposalLimit: 0
  permissions:
    network: read_only
    filesystem: workspace_read
  completion:
    type: executable
    command: "done"
`;
}

function skillBody() {
  return `---
name: market-guide
description: Provides the current market guidance marker.
---

When asked for market guidance, return exactly: ${marker}
`;
}

async function request(baseUrl, path, bearer, options) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method,
    headers: {
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
      ...(options.idempotencyKey
        ? { 'idempotency-key': options.idempotencyKey }
        : {}),
    },
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

async function waitForAssistant(baseUrl, sessionId, bearer, turn) {
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
    const assistant = (response.messages ?? []).filter(
      (message) => message.role === 'assistant',
    )[0];
    if (
      task.status === 'completed' &&
      run.status === 'succeeded' &&
      assistant
    ) {
      if (assistant.text !== marker)
        throw new Error('assistant_exact_output_mismatch');
      return assistant;
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

async function readReceipts(root, digest) {
  const files = await listFiles(join(root, 'skill-receipts'));
  const skillFiles = files.filter((path) => !path.includes('/grants/'));
  const grantFiles = files.filter((path) => path.includes('/grants/'));
  if (skillFiles.length !== 1) throw new Error('skill_receipt_count_mismatch');
  const path = skillFiles[0];
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o444)
    throw new Error('skill_receipt_mode_mismatch');
  const value = JSON.parse(await readFile(path, 'utf8'));
  if (
    !sameKeys(value, ['format', 'ref', 'digest', 'delivery']) ||
    value.format !== 1 ||
    value.ref !== 'project/research-agent/market-guide' ||
    value.digest !== digest ||
    value.delivery !== 'native_project'
  )
    throw new Error('skill_receipt_content_mismatch');
  return { skill: 1, grant: grantFiles.length };
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

function sameKeys(value, keys) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

async function inspectProviderRecord(root, providerAgentId, markerValue) {
  const files = await listFiles(root);
  if (files.length > 512) throw new Error('runtime_state_bound_exceeded');
  const candidates = [];
  for (const path of files) {
    const content = await readFile(path, 'utf8').catch(() => null);
    if (!content || content.length > 2 * 1024 * 1024) continue;
    for (const document of parseStructuredDocuments(content)) {
      findProviderRecords(document, providerAgentId, 0, candidates);
    }
  }
  const identified = candidates.find(
    (candidate) => candidate.id === providerAgentId,
  );
  if (!identified) {
    throw new Error('provider_record_missing');
  }
  if (
    !identified.config ||
    typeof identified.config !== 'object' ||
    Array.isArray(identified.config) ||
    typeof identified.config.systemPrompt !== 'string'
  )
    throw new Error('provider_record_system_prompt_missing');
  const systemPrompt = identified.config.systemPrompt;
  return {
    providerRecordFound: true,
    markerAbsentFromProviderSystemPrompt: !systemPrompt.includes(markerValue),
    mcpConfigPersisted: containsMcpServers(identified, 0),
  };
}

function findProviderRecords(value, providerAgentId, depth, found) {
  if (depth > 8 || !value || typeof value !== 'object') return;
  if (!Array.isArray(value)) {
    if (value.id === providerAgentId) found.push(value);
    for (const child of Object.values(value)) {
      findProviderRecords(child, providerAgentId, depth + 1, found);
    }
  } else {
    for (const child of value) {
      findProviderRecords(child, providerAgentId, depth + 1, found);
    }
  }
}

function containsMcpServers(value, depth) {
  if (depth > 8 || !value || typeof value !== 'object') return false;
  if (Array.isArray(value))
    return value.some((item) => containsMcpServers(item, depth + 1));
  for (const [key, child] of Object.entries(value)) {
    if (key === 'mcpServers' || key === 'mcp_servers') return true;
    if (containsMcpServers(child, depth + 1)) return true;
  }
  return false;
}

async function inspectRegistry(root, digest) {
  const ref = 'project/research-agent/market-guide';
  const manifestPath = join(
    root,
    'refs',
    'project',
    'research-agent',
    'market-guide.json',
  );
  const objectPath = join(root, 'objects', digest);
  const manifestStat = await lstat(manifestPath);
  const objectStat = await lstat(objectPath);
  if (
    !manifestStat.isFile() ||
    manifestStat.isSymbolicLink() ||
    (manifestStat.mode & 0o777) !== 0o444 ||
    !objectStat.isDirectory() ||
    objectStat.isSymbolicLink() ||
    (objectStat.mode & 0o777) !== 0o555 ||
    (await realpath(objectPath)).split(sep).at(-1) !== digest
  )
    throw new Error('registry_object_mode_or_linkage_mismatch');
  const logical = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (
    !sameKeys(logical, [
      'format',
      'ref',
      'name',
      'digest',
      'delivery',
      'requiredToolRefs',
      'object',
    ]) ||
    logical.format !== 1 ||
    logical.ref !== ref ||
    logical.name !== 'market-guide' ||
    logical.digest !== digest ||
    logical.delivery !== 'native_project' ||
    JSON.stringify(logical.requiredToolRefs) !== '[]' ||
    logical.object !== `objects/${digest}`
  )
    throw new Error('logical_manifest_mismatch');
  const objectManifestPath = join(objectPath, 'manifest.json');
  const objectManifestStat = await lstat(objectManifestPath);
  if (
    !objectManifestStat.isFile() ||
    objectManifestStat.isSymbolicLink() ||
    (objectManifestStat.mode & 0o777) !== 0o444
  )
    throw new Error('object_manifest_mode_mismatch');
  const objectManifest = JSON.parse(await readFile(objectManifestPath, 'utf8'));
  if (
    !sameKeys(objectManifest, ['format', 'digest', 'files']) ||
    objectManifest.format !== 1 ||
    objectManifest.digest !== digest ||
    !Array.isArray(objectManifest.files)
  )
    throw new Error('object_manifest_mismatch');
  const files = await collectRegistryFiles(objectPath);
  const expected = new Map();
  for (const file of objectManifest.files) {
    if (
      !sameKeys(file, ['path', 'sha256', 'size']) ||
      typeof file.path !== 'string' ||
      file.path === 'manifest.json' ||
      file.path
        .split('/')
        .some((part) => !part || part === '.' || part === '..') ||
      !/^[0-9a-f]{64}$/.test(file.sha256) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      expected.has(file.path)
    )
      throw new Error('object_manifest_file_entry_mismatch');
    expected.set(file.path, file);
  }
  if (
    files.length !== expected.size ||
    localSkillDigest(files) !== digest ||
    files.some((file) => {
      const item = expected.get(file.path);
      return (
        !item ||
        item.size !== file.bytes.byteLength ||
        item.sha256 !== createHash('sha256').update(file.bytes).digest('hex')
      );
    })
  )
    throw new Error('registry_files_digest_mismatch');
  return {
    logicalManifestValid: true,
    objectManifestValid: true,
    filesDigestValid: true,
  };
}

async function collectRegistryFiles(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) throw new Error('registry_symlink');
      if (stat.isDirectory()) {
        if ((stat.mode & 0o777) !== 0o555)
          throw new Error('registry_directory_mode');
        await visit(path);
      } else if (relative(root, path) !== 'manifest.json') {
        if (!stat.isFile() || (stat.mode & 0o777) !== 0o444)
          throw new Error('registry_file_mode');
        files.push({
          path: relative(root, path).split(sep).join('/'),
          bytes: await readFile(path),
        });
      }
    }
  }
  await visit(root);
  return files;
}

function localSkillDigest(files) {
  const hash = createHash('sha256');
  hash.update(Buffer.from('agent-server-skill-package-v1\0', 'utf8'));
  for (const file of [...files].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  )) {
    const path = Buffer.from(file.path, 'utf8');
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(path.byteLength), 0);
    hash.update(length);
    hash.update(path);
    length.writeBigUInt64BE(BigInt(file.bytes.byteLength), 0);
    hash.update(length);
    hash.update(file.bytes);
  }
  return hash.digest('hex');
}

function parseStructuredDocuments(content) {
  try {
    return [JSON.parse(content)];
  } catch {
    return content
      .split('\n')
      .map((line) => line.trim())
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

async function installedVersion(packageNames) {
  for (const packageName of packageNames) {
    try {
      return (
        JSON.parse(
          await readFile(
            join(repositoryRoot, 'node_modules', packageName, 'package.json'),
            'utf8',
          ),
        ).version ?? null
      );
    } catch {}
  }
  return null;
}

function replaceDatabase(value, database) {
  const url = new URL(value);
  url.pathname = `/${database}`;
  return url.toString();
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
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
    'runtime_project_registry_root',
    () => removeRoot(runtimeRoot),
    failures,
  );
  if (failures.length === 0 && retainDatabase)
    return {
      success: true,
      runtimeStateRemoved: !(await exists(runtimeRoot)),
      failures,
    };
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

async function removeRoot(root) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await makeRemovable(root);
    try {
      await rm(root, { recursive: true, force: true });
      if (!(await exists(root))) return;
    } catch (error) {
      if (!['ENOTEMPTY', 'EBUSY', 'EPERM'].includes(error?.code)) throw error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  if (await exists(root)) throw new Error('root_remains');
}

async function makeRemovable(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  )) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await makeRemovable(path);
    else if (entry.isFile()) await chmod(path, 0o644).catch(() => undefined);
  }
  await chmod(directory, 0o755).catch(() => undefined);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function safeErrorCode(error) {
  if (error?.message && /^[a-z0-9_]+$/.test(error.message))
    return error.message;
  return error?.code && /^[A-Za-z0-9_.-]+$/.test(error.code)
    ? error.code
    : error?.name && /^[A-Za-z0-9_.-]+$/.test(error.name)
      ? error.name
      : 'smoke_failure';
}
