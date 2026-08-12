import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { register as registerTsx } from 'tsx/esm/api';
registerTsx();
import { serve } from '@hono/node-server';
import { Client } from 'pg';
import {
  getAvailablePort,
  startPaseo,
  stopProcessTree,
  waitForHttp,
} from '../dev/paseo-process.mjs';
import {
  createOpenCodeConfigContent,
  loadRealProviderDefaults,
} from '../dev/real-provider-defaults.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const realProviderDefaults = loadRealProviderDefaults();
process.env.PASEO_PROVIDER =
  process.env.PASEO_PROVIDER?.trim() || realProviderDefaults.PASEO_PROVIDER;
process.env.PASEO_MODEL =
  process.env.PASEO_MODEL?.trim() || realProviderDefaults.PASEO_MODEL;
const adminUrl = process.env.POSTGRES_ADMIN_URL;
const token = `phase3-${randomUUID()}`;
const tenantId = 'tenant_self_learning_phase3';
const principalId = 'svc_self_learning_phase3';
const workspaceId = randomUUID();
const dbName = `agent_server_phase3_${Date.now()}_${randomUUID().slice(0, 8)}`;
const runtimeRoot = join(
  root,
  '.local',
  'self-learning-team-phase3-smoke',
  `${process.pid}-${randomUUID().slice(0, 8)}`,
);
const projectCwd = join(runtimeRoot, 'project');
const cellRoot = join(runtimeRoot, 'cells');
const timeoutMs = Number(process.env.PHASE3_SMOKE_TIMEOUT_MS ?? '240000');
const pollMs = Number(process.env.PHASE3_SMOKE_POLL_MS ?? '500');
const execFileAsync = promisify(execFile);
let admin, db, paseo, api, service, next, apiUrl, webUrl;

try {
  if (!adminUrl) throw new Error('missing_POSTGRES_ADMIN_URL');
  admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${dbName.replaceAll('"', '""')}"`);
  const dbUrl = new URL(adminUrl);
  dbUrl.pathname = `/${dbName}`;
  await mkdir(runtimeRoot, { recursive: true });
  await runAgentctl([
    'init',
    projectCwd,
    '--template',
    'self-learning-market-research',
  ]);

  const useGo =
    Boolean(process.env.OPENCODE_GO_API_KEY?.trim()) &&
    process.env.PASEO_MODEL.startsWith('opencode-go/');
  if (useGo)
    process.env.OPENCODE_CONFIG_CONTENT = createOpenCodeConfigContent({
      model: process.env.PASEO_MODEL,
    });
  paseo = await startPaseo({
    repositoryRoot: root,
    runtimeRoot,
    port: await getAvailablePort(),
    environmentVariableNames: useGo
      ? [
          'PASEO_PROVIDER',
          'PASEO_MODEL',
          'OPENCODE_GO_API_KEY',
          'OPENCODE_CONFIG_CONTENT',
        ]
      : ['PASEO_PROVIDER', 'PASEO_MODEL'],
  });
  const apiPort = await getAvailablePort();
  Object.assign(process.env, {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(apiPort),
    DATABASE_URL: dbUrl.toString(),
    POSTGRES_URL: dbUrl.toString(),
    PASEO_WS_URL: paseo.wsUrl,
    PASEO_AGENT_CWD: projectCwd,
    PASEO_RUNTIME_CELL_ROOT: cellRoot,
    AGENT_SERVER_SKILL_REGISTRY_ROOT: join(runtimeRoot, 'skills'),
    SERVICE_ACCOUNTS_JSON: JSON.stringify([
      {
        serviceAccountId: principalId,
        token,
        tenantId,
        workspaceId,
        policyVersion: 'phase3-mve-v1',
      },
    ]),
  });
  const { loadConfig } = await import('../../src/shared/config.ts');
  const { createLogger } =
    await import('../../src/shared/observability/logger.ts');
  const { createService } = await import('../../src/bootstrap.ts');
  const config = loadConfig();
  service = await createService(
    config,
    createLogger({
      service: config.serviceName,
      minimumLevel: config.logLevel,
      write: () => undefined,
    }),
  );
  await service.runtime.initialize();
  api = serve({
    fetch: service.app.fetch,
    hostname: '127.0.0.1',
    port: apiPort,
  });
  apiUrl = `http://127.0.0.1:${apiPort}`;
  await waitForHttp(`${apiUrl}/health/ready`, 90_000);
  db = new Client({ connectionString: dbUrl.toString() });
  await db.connect();
  await db.query(
    'INSERT INTO workspaces(id,tenant_id,principal_type,principal_id,name,created_at,updated_at) VALUES($1,$2,$3,$4,$5,now(),now())',
    [
      workspaceId,
      tenantId,
      'service_account',
      principalId,
      'Self-Learning Market Research',
    ],
  );

  await runAgentctl(['validate']);
  const before = await resourceCounts();
  const plan = await runAgentctl(['plan']);
  if (JSON.stringify(plan) !== JSON.stringify(await runAgentctl(['plan'])))
    throw new Error('plan_not_deterministic');
  if (JSON.stringify(before) !== JSON.stringify(await resourceCounts()))
    throw new Error('plan_wrote_resources');
  await runAgentctl(['apply']);
  const lockPath = join(projectCwd, 'agent-project.lock.json');
  const lockBytes = await readFile(lockPath);
  const lock = JSON.parse(lockBytes);
  if (
    /token|baseURL|runtimeRoot|source:|content:|prompt:|apiKey|\/(?:Users|Volumes)\//i.test(
      lockBytes.toString(),
    )
  )
    throw new Error('lock_contains_sensitive_data');
  const reapplied = await runAgentctl(['apply']);
  if (!reapplied.completed?.some((s) => ['Reuse', 'NoOp'].includes(s.outcome)))
    throw new Error('reapply_not_stable');
  if (Buffer.compare(lockBytes, await readFile(lockPath)) !== 0)
    throw new Error('lock_not_byte_stable');
  const store = lock.memoryStores.find((s) => s.ref === 'memory://research');
  const seed = store?.seeds?.find((s) => s.path === 'research/principles.md');
  const team = lock.teams.find((s) => s.ref === 'team://market-research');
  if (!store?.id || !seed?.memoryId || !team?.versionId)
    throw new Error('resolved_lock_missing');

  const webPort = await getAvailablePort();
  webUrl = `http://127.0.0.1:${webPort}`;
  next = spawn(
    'pnpm',
    [
      '--dir',
      join(root, 'apps/web'),
      'exec',
      'next',
      'dev',
      '-p',
      String(webPort),
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        AGENT_SERVER_BASE_URL: apiUrl,
        AGENT_SERVER_SERVICE_TOKEN: token,
        WEB_WORKSPACE_ID: workspaceId,
        WEB_SELF_LEARNING_TEAM_VERSION_ID: team.versionId,
        WEB_SELF_LEARNING_MEMORY_STORE_ID: store.id,
      },
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'ignore', 'ignore'],
    },
  );
  await waitForHttp(`${webUrl}/projects`, 90_000);
  const launch = await webRequest('/api/projects/self-learning/runs', {
    method: 'POST',
    body: {},
    status: 202,
  });
  if (!onlyKeys(launch, ['root_task_id']) || !uuid(launch.root_task_id))
    throw new Error('launch_contract_invalid');
  const rootTaskId = launch.root_task_id;
  const aggregate = await pollAggregate(rootTaskId);
  await assertAggregate(aggregate, rootTaskId, store.id, seed.path);
  const accepted = await webRequest(
    `/api/projects/self-learning/runs/${rootTaskId}/proposals/${aggregate.proposal.learning_proposal_id}/review`,
    { method: 'POST', body: { action: 'accept' }, status: 200 },
  );
  if (
    !accepted.proposal?.accepted_memory_version_id ||
    accepted.proposal.status !== 'accepted'
  )
    throw new Error('review_contract_invalid');
  const refreshed = await pollAggregate(rootTaskId, true);
  assertAcceptedMemory(
    refreshed,
    accepted.proposal.accepted_memory_version_id,
    seed,
  );
  const canonical = await apiRequest(
    `/api/v1/memory-stores/${store.id}/memories/${seed.memoryId}`,
    200,
  );
  if (
    canonical.memory.memory_version_id !==
      refreshed.memory_receipt.memory_version_id ||
    canonical.memory.content_sha256 !==
      refreshed.memory_receipt.content_sha256 ||
    canonical.memory.content !== refreshed.memory_receipt.content
  )
    throw new Error('memory_receipt_mismatch');
  assertAcceptedMemory(
    await webRequest(`/api/projects/self-learning/runs/${rootTaskId}`, {
      status: 200,
    }),
    accepted.proposal.accepted_memory_version_id,
    seed,
  );
  await webRequest('/api/projects/self-learning/runs/not-a-uuid', {
    status: 404,
  });
  await webRequest(`/api/projects/self-learning/runs/${randomUUID()}`, {
    status: 404,
  });
  await webRequest('/api/projects/self-learning/runs', {
    method: 'POST',
    body: { unknown: true },
    status: 400,
  });
  if (process.env.PHASE3_SMOKE_RETAIN_FILE) {
    const retain = resolve(process.env.PHASE3_SMOKE_RETAIN_FILE);
    const temp = `${retain}.tmp-${process.pid}`;
    await writeFile(
      temp,
      JSON.stringify({ web_url: webUrl, root_task_id: rootTaskId }) + '\n',
      { mode: 0o600 },
    );
    await rename(temp, retain);
    console.log(
      JSON.stringify({
        status: 'retained-ready',
        web_url: webUrl,
        root_task_id: rootTaskId,
      }),
    );
    await waitForSignal();
  } else
    console.log(
      JSON.stringify({
        status: 'passed',
        synthetic_demo_only: true,
        web_url: webUrl,
        root_task_id: rootTaskId,
        memory_path: seed.path,
        memory_content_sha256: refreshed.memory_receipt.content_sha256,
        activity_tools: [
          ...new Set(refreshed.activities.map((a) => a.tool)),
        ].sort(),
      }),
    );
} catch (error) {
  console.error(
    JSON.stringify({
      status: 'failed',
      reason:
        error instanceof Error
          ? error.message.replace(
              /\b(?:token|key|secret|password)\b[^\s]*/gi,
              '[redacted]',
            )
          : 'unknown',
    }),
  );
  process.exitCode = 1;
} finally {
  await cleanup();
}

async function runAgentctl(args) {
  const command = args[0];
  const commandArgs = new Set(['validate', 'plan', 'apply']).has(command)
    ? [...args, '--manifest', join(projectCwd, 'agent-project.yaml')]
    : args;
  const env = {
    ...process.env,
    AGENT_SERVER_SKILL_REGISTRY_ROOT: join(runtimeRoot, 'skills'),
  };
  if (new Set(['apply', 'run']).has(command))
    Object.assign(env, {
      AGENT_SERVER_BASE_URL: apiUrl,
      AGENT_SERVER_TOKEN: token,
      AGENT_SERVER_WORKSPACE_ID: workspaceId,
    });
  const { stdout } = await execFileAsync(
    'pnpm',
    ['--dir', root, 'agentctl', ...commandArgs],
    {
      cwd: command === 'init' ? root : projectCwd,
      env,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout.trim().split('\n').at(-1));
}
async function apiRequest(path, status) {
  return request(`${apiUrl}${path}`, {
    status,
    headers: { authorization: `Bearer ${token}` },
  });
}
async function webRequest(path, options = {}) {
  return request(`${webUrl}${path}`, {
    ...options,
    headers: { origin: webUrl, ...(options.headers ?? {}) },
  });
}
async function request(url, options = {}) {
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = await response.json().catch(() => null);
  if (response.status !== options.status)
    throw new Error(`http_${response.status}_expected_${options.status}`);
  return body;
}
async function pollAggregate(id, afterReview = false) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await webRequest(`/api/projects/self-learning/runs/${id}`, {
      status: 200,
    });
    if (value.team_run?.status === 'failed' || value.status === 'failed')
      throw new Error('learn_run_failed');
    if (
      value.status === 'completed' &&
      value.team_run?.status === 'succeeded' &&
      value.team_run.phase === 'done' &&
      value.report?.text &&
      value.proposal &&
      (!afterReview ||
        (value.proposal.status === 'accepted' && value.memory_receipt))
    )
      return value;
    await new Promise((wait) => setTimeout(wait, pollMs));
  }
  throw new Error('phase3_smoke_timeout');
}
async function assertAggregate(value, rootTaskId, storeId, path) {
  if (
    value.root_task_id !== rootTaskId ||
    !value.team_run ||
    !value.members?.length ||
    !value.work_items?.length
  )
    throw new Error('aggregate_lineage_invalid');
  const missingSections = [
    'Scope',
    'Snapshot',
    'Events',
    'Opportunities',
    'Analog',
    'Learning loop',
  ].filter(
    (section) => !new RegExp(section, 'i').test(value.report?.text ?? ''),
  );
  if (missingSections.length)
    throw new Error(
      `report_sections_missing:${missingSections.join(',')}:truncated_${Boolean(value.report?.truncated)}:preview_${safePreview(value.report?.text)}`,
    );
  const tools = new Set(value.activities.map((a) => a.tool));
  for (const tool of [
    'synthetic_stock_snapshot',
    'synthetic_event_batch',
    'synthetic_analog_summary',
    'learning_proposal_create',
  ])
    if (!tools.has(tool)) throw new Error(`activity_missing:${tool}`);
  if (
    [...tools].some(
      (tool) =>
        ![
          'synthetic_stock_snapshot',
          'synthetic_event_batch',
          'synthetic_analog_summary',
          'learning_proposal_create',
          'agent_server_memory_read',
        ].includes(tool),
    )
  )
    throw new Error('unapproved_activity');
  const proposal = value.proposal;
  if (
    !proposal ||
    proposal.status !== 'pending' ||
    proposal.target.path !== path ||
    !proposal.proposed_content ||
    !proposal.evidence_refs?.length
  )
    throw new Error('proposal_projection_invalid');
  if (
    !value.tasks.some(
      (task) =>
        task.task_id === proposal.source.task_id && task.latest_run_status,
    )
  )
    throw new Error('proposal_lineage_invalid');
  const sourceTask = await apiRequest(
    `/api/v1/tasks/${proposal.source.task_id}`,
    200,
  );
  if (
    sourceTask.root_task_id !== rootTaskId ||
    sourceTask.latest_run?.run_id !== proposal.source.run_id
  )
    throw new Error('proposal_source_run_invalid');
  scanSafe(value);
}
function assertAcceptedMemory(value, versionId, seed) {
  if (
    !value.proposal ||
    value.proposal.status !== 'accepted' ||
    value.proposal.accepted_memory_version_id !== versionId ||
    !value.memory_receipt ||
    value.memory_receipt.path !== seed.path ||
    value.memory_receipt.memory_version_id !== versionId ||
    !value.memory_receipt.content
  )
    throw new Error('accepted_memory_invalid');
  scanSafe(value);
}
function scanSafe(value, key = '$') {
  if (
    key &&
    /authorization|bearer|token|provider|runtime|principal|tenant|payload|raw|prompt|agent[_-]?version|environment[_-]?version|error/i.test(
      key,
    )
  )
    throw new Error(`forbidden_bff_key:${key}`);
  if (
    typeof value === 'string' &&
    /Bearer\s|\bsk-[A-Za-z0-9]{8,}|opencode|paseo|\/(?:Users|Volumes|private|tmp)\//i.test(
      value,
    )
  )
    throw new Error(
      `forbidden_bff_value:${key}:${/Bearer\s|\bsk-[A-Za-z0-9]{8,}/i.test(value) ? 'credential_marker' : /opencode|paseo/i.test(value) ? 'provider_name' : 'absolute_path'}`,
    );
  if (Array.isArray(value))
    for (const [index, item] of value.entries())
      scanSafe(item, `${key}[${index}]`);
  else if (value && typeof value === 'object')
    for (const [name, item] of Object.entries(value))
      scanSafe(item, `${key}.${name}`);
}
function onlyKeys(value, keys) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join() === keys.slice().sort().join()
  );
}
function safePreview(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/bearer\s+[^\s]+/gi, 'bearer [redacted]')
    .replace(
      /(?:~\/|\/(?:Users|Volumes|private|tmp)\/)[^\s]+/g,
      '[redacted path]',
    )
    .slice(0, 240);
}
function uuid(value) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
async function resourceCounts() {
  const result = {};
  for (const table of [
    'workspaces',
    'agent_definitions',
    'environment_definitions',
    'team_definitions',
    'memory_stores',
  ])
    result[table] = (
      await db.query(`SELECT count(*)::int AS count FROM ${table}`)
    ).rows[0].count;
  return result;
}
function waitForSignal() {
  return new Promise((done) => {
    const finish = () => {
      process.off('SIGINT', finish);
      process.off('SIGTERM', finish);
      done();
    };
    process.once('SIGINT', finish);
    process.once('SIGTERM', finish);
  });
}
async function cleanup() {
  await new Promise((done) => api?.close?.(() => done()) ?? done()).catch(
    () => undefined,
  );
  await service?.close?.().catch(() => undefined);
  await db?.end().catch(() => undefined);
  await admin
    ?.query(`DROP DATABASE IF EXISTS "${dbName.replaceAll('"', '""')}"`)
    .catch(() => undefined);
  await admin?.end().catch(() => undefined);
  await (next ? stopProcessTree(next) : Promise.resolve()).catch(
    () => undefined,
  );
  await (paseo?.child ? stopProcessTree(paseo.child) : Promise.resolve()).catch(
    () => undefined,
  );
  await rm(runtimeRoot, { recursive: true, force: true }).catch(
    () => undefined,
  );
}
