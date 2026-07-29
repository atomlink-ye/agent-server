import { randomUUID } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const adminUrl = process.env.POSTGRES_ADMIN_URL;
const runId = `${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`;
const token = `team-dag-inspect-${randomUUID()}`;
const tenantId = 'tenant_team_dag_inspect';
const principalId = 'svc_team_dag_inspect';
const workspaceId = randomUUID();
const dbName = `agent_server_team_dag_inspect_${Date.now()}_${randomUUID().slice(0, 8)}`;
const runtimeRoot = join(root, '.local', 'team-dag-inspect', runId);
const projectCwd = join(runtimeRoot, 'project');
const cellRoot = join(runtimeRoot, 'cells');
const snapshotsRoot = join(runtimeRoot, 'snapshots');
let admin;
let db;
let paseo;
let api;
let service;
let apiUrl;
let dbUrl;
let retained = false;
const snapshotPaths = [];

try {
  if (!adminUrl) throw new Error('missing_POSTGRES_ADMIN_URL');
  const parsed = new URL(adminUrl);
  if (parsed.hostname !== '127.0.0.1' || parsed.port !== '55433')
    throw new Error('unexpected_postgres_endpoint');
  await mkdir(projectCwd, { recursive: true });
  await mkdir(snapshotsRoot, { recursive: true });
  admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${dbName.replaceAll('"', '""')}"`);
  dbUrl = new URL(adminUrl);
  dbUrl.pathname = `/${dbName}`;
  dbUrl = dbUrl.toString();
  db = new Client({ connectionString: dbUrl });

  paseo = await startPaseo({
    repositoryRoot: root,
    runtimeRoot,
    port: await getAvailablePort(),
  });
  const apiPort = await getAvailablePort();
  process.env.NODE_ENV = 'test';
  process.env.HOST = '127.0.0.1';
  process.env.PORT = String(apiPort);
  process.env.DATABASE_URL = dbUrl;
  process.env.POSTGRES_URL = dbUrl;
  process.env.PASEO_WS_URL = paseo.wsUrl;
  process.env.PASEO_AGENT_CWD = projectCwd;
  process.env.PASEO_RUNTIME_CELL_ROOT = cellRoot;
  process.env.AGENT_SERVER_SKILL_REGISTRY_ROOT = join(runtimeRoot, 'skills');
  process.env.PASEO_MODEL =
    process.env.PASEO_MODEL || 'opencode/deepseek-v4-flash-free';
  process.env.SERVICE_ACCOUNTS_JSON = JSON.stringify([
    {
      serviceAccountId: principalId,
      token,
      tenantId,
      workspaceId,
      policyVersion: 'team-dag-inspect-v1',
    },
  ]);
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
  await db.connect();
  await db.query(
    'INSERT INTO workspaces(id,tenant_id,principal_type,principal_id,name,created_at,updated_at) VALUES($1,$2,$3,$4,$5,now(),now())',
    [
      workspaceId,
      tenantId,
      'service_account',
      principalId,
      'Team DAG Retained Inspect',
    ],
  );

  const agents = [];
  for (const [name, skill] of [
    ['research-a', true],
    ['research-b', false],
    ['synthesizer', false],
  ]) {
    const imported = await request('/api/v1/agents:import', {
      method: 'POST',
      body: { source: agentYaml(name, skill) },
      idempotencyKey: randomUUID(),
      status: 201,
    });
    await request(`/api/v1/agent-versions/${imported.version.id}:publish`, {
      method: 'POST',
      body: {},
      idempotencyKey: randomUUID(),
      status: 200,
    });
    agents.push(imported.version.id);
  }
  const env = await request('/api/v1/environments:import', {
    method: 'POST',
    body: { source: environmentYaml() },
    idempotencyKey: randomUUID(),
    status: 201,
  });
  await request(`/api/v1/environment-versions/${env.version.id}:publish`, {
    method: 'POST',
    body: {},
    idempotencyKey: randomUUID(),
    status: 200,
  });

  const { PostgresInvokableRepository } =
    await import('../../src/infrastructure/postgres/postgres-invokable-repository.ts');
  const { PostgresEnvironmentRegistry } =
    await import('../../src/infrastructure/postgres/postgres-environment-registry.ts');
  const { DagTeamCompiler } =
    await import('../../src/application/invokables/dag-team-compiler.ts');
  const { createTeamDefinition } =
    await import('../../src/domain/invokables/team-definition.ts');
  const { createDraftTeamVersion, publishTeamVersion } =
    await import('../../src/domain/invokables/team-version.ts');
  const invokables = new PostgresInvokableRepository(db);
  const environments = new PostgresEnvironmentRegistry(db);
  const owner = {
    tenantId,
    workspaceId,
    principalType: 'service_account',
    principalId,
  };
  const definition = createTeamDefinition({
    ...owner,
    name: 'MVE Team DAG Retained Inspect',
  });
  await invokables.saveTeamDefinition(definition);
  const draft = createDraftTeamVersion({
    ...owner,
    definitionId: definition.id,
    name: 'MVE Team DAG Retained Inspect v1',
    environmentVersionId: env.version.id,
    graph: {
      mode: 'dag-mve-v1',
      nodes: [
        {
          id: 'research-a',
          kind: 'invoke',
          agentVersionId: agents[0],
          dependsOn: [],
          output: 'step',
        },
        {
          id: 'research-b',
          kind: 'invoke',
          agentVersionId: agents[1],
          dependsOn: [],
          output: 'step',
        },
        {
          id: 'synthesize',
          kind: 'invoke',
          agentVersionId: agents[2],
          dependsOn: ['research-a', 'research-b'],
          output: 'final',
        },
      ],
    },
  });
  const plan = await new DagTeamCompiler(invokables, environments).compile(
    draft,
  );
  const published = publishTeamVersion(draft, plan);
  await invokables.saveTeamVersion(published);
  const invoked = await request('/api/v1/tasks:invoke', {
    method: 'POST',
    body: {
      workspace_id: workspaceId,
      invokable: { kind: 'team', version_id: published.id },
      input: { text: 'Research two independent facts and synthesize them.' },
    },
    idempotencyKey: randomUUID(),
    status: 202,
  });
  const teamExecution = await waitForMilestones(invoked.task_id);
  const manifest = {
    runId,
    apiUrl,
    dbName,
    dbUrl: redactDbUrl(dbUrl),
    rootTaskId: invoked.task_id,
    teamDefinitionId: definition.id,
    teamVersionId: published.id,
    environmentVersionId: env.version.id,
    agentVersionIds: agents,
    teamExecutionId: teamExecution.id,
    runtimeRoot,
    projectCwd,
    cellRoot,
    paseo: {
      wsUrl: paseo.wsUrl,
      healthUrl: paseo.healthUrl,
      logPath: paseo.logPath,
    },
    snapshotPaths,
    cleanupGuidance:
      'Stop this process after inspection; retained API/Paseo processes and database require manual cleanup.',
  };
  const manifestPath = join(runtimeRoot, 'manifest.json');
  const inspectEnvPath = join(runtimeRoot, 'inspect.env');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(
    inspectEnvPath,
    `API_URL=${apiUrl}\nTOKEN=${token}\nROOT_TASK_ID=${invoked.task_id}\nDATABASE_URL=${shellQuote(dbUrl)}\nDB_NAME=${dbName}\nRUNTIME_ROOT=${shellQuote(runtimeRoot)}\n`,
  );
  await chmod(inspectEnvPath, 0o600);
  retained = true;
  console.log(
    JSON.stringify({
      status: 'completed',
      api_url: apiUrl,
      root_task_id: invoked.task_id,
      db_name: dbName,
      runtime_root: runtimeRoot,
      manifest_path: manifestPath,
      inspect_env_path: inspectEnvPath,
      snapshot_paths: snapshotPaths,
      example_commands: [
        `source ${inspectEnvPath} && curl -sS -H "Authorization: Bearer $TOKEN" "$API_URL/api/v1/tasks/$ROOT_TASK_ID"`,
        `source ${inspectEnvPath} && psql "$DATABASE_URL"`,
      ],
    }),
  );
  await new Promise(() => {});
} catch (error) {
  console.error(
    `retained_inspect_failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  console.error(
    JSON.stringify({
      db_name: dbName,
      runtime_root: runtimeRoot,
      api_url: apiUrl ?? null,
    }),
  );
  process.exitCode = 1;
} finally {
  if (!retained) {
    await new Promise((done) => api?.close?.(() => done()) ?? done()).catch(
      () => undefined,
    );
    await service?.close?.().catch(() => undefined);
    await db?.end().catch(() => undefined);
    await (
      paseo?.child ? stopProcessTree(paseo.child) : Promise.resolve()
    ).catch(() => undefined);
    await admin?.end().catch(() => undefined);
  }
}

async function request(path, options) {
  const response = await fetch(`${apiUrl}${path}`, {
    method: options.method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': options.idempotencyKey ?? '',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (response.status !== options.status)
    throw new Error(`http_${response.status}_expected_${options.status}`);
  return response.json();
}
async function waitForMilestones(taskId) {
  let waiting = false;
  let synthesizer = false;
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    const task = await request(`/api/v1/tasks/${taskId}`, {
      method: 'GET',
      status: 200,
    });
    const tree = await request(`/api/v1/tasks/${taskId}/tree`, {
      method: 'GET',
      status: 200,
    });
    const children = tree.tasks.filter((entry) => entry.task_id !== taskId);
    if (
      !waiting &&
      task.latest_run?.status === 'waiting_children' &&
      children.length >= 2
    ) {
      await snapshot('waiting_children', task, tree);
      waiting = true;
    }
    if (!synthesizer && children.length >= 3) {
      await snapshot('synthesizer_created', task, tree);
      synthesizer = true;
    }
    if (task.status === 'completed') {
      const rows = await db.query(
        'SELECT id FROM team_executions WHERE root_task_id=$1',
        [taskId],
      );
      await snapshot('completed', task, tree);
      return rows.rows[0];
    }
    if (['failed', 'cancelled'].includes(task.status))
      throw new Error(`root_not_completed:${task.status}`);
    await new Promise((delay) => setTimeout(delay, 1000));
  }
  throw new Error('root_timeout');
}
async function snapshot(name, task, tree) {
  const queries = {
    team_executions: 'SELECT * FROM team_executions ORDER BY created_at',
    team_node_executions:
      'SELECT * FROM team_node_executions ORDER BY created_at',
    tasks:
      'SELECT id AS task_id,status,parent_task_id,root_task_id,depth,node_path,invokable_kind,invokable_version_id FROM tasks ORDER BY created_at',
    runs: "SELECT id,task_id,attempt,status,runtime->>'runtimeSessionId' AS runtime_session_id,runtime->>'runtimeCellId' AS runtime_cell_id,runtime->>'paseoWorkspaceId' AS paseo_workspace_id,runtime->>'providerAgentId' AS provider_agent_id FROM runs ORDER BY created_at",
    runtime_sessions: 'SELECT * FROM runtime_sessions ORDER BY created_at',
    session_launch_snapshots:
      'SELECT * FROM session_launch_snapshots ORDER BY created_at',
  };
  const database = {};
  for (const [key, sql] of Object.entries(queries))
    database[key] = (await db.query(sql)).rows.map(sanitize);
  const path = join(snapshotsRoot, `${name}.json`);
  await writeFile(
    path,
    `${JSON.stringify(sanitize({ milestone: name, capturedAt: new Date().toISOString(), rootTask: task, tree, ...database }), null, 2)}\n`,
  );
  snapshotPaths.push(path);
}
function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/token|authorization|password|secret/i.test(key))
        .map(([key, entry]) => [key, sanitize(entry)]),
    );
  return typeof value === 'string'
    ? value
        .replaceAll(token, '[redacted]')
        .replaceAll(runtimeRoot, '<runtime-root>')
    : value;
}
function redactDbUrl(value) {
  const url = new URL(value);
  if (url.password) url.password = '<redacted>';
  return url.toString();
}
function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
function agentYaml(name, skill) {
  return `apiVersion: agent-server/v1alpha1\nkind: ManagedAgent\nmetadata:\n  name: ${name}\nspec:\n  description: Team DAG retained inspection agent\n  instructions: Return a concise factual result for the assigned research or synthesis task.\n  runtime:\n    provider: paseo\n    modelPolicyRef: free-only\n    mode: isolated\n  tools:\n    - ref: agent-server/memory-read\n      kind: tool\n  skills:\n    - ref: agent-server/memory-api\n  input:\n    schema:\n      type: object\n      properties: {}\n      additionalProperties: false\n    prompt: "Execute the assigned task."\n  session:\n    invocation: fresh_per_invocation\n    followUps: queued\n    binding: reusable\n  memory:\n    policy: workspace_snapshot\n    proposalLimit: 0\n  permissions:\n    network: read_only\n    filesystem: workspace_read\n  completion:\n    type: executable\n    command: "done"\n`;
}
function environmentYaml() {
  return 'apiVersion: agent-server/v1alpha1\nkind: ManagedEnvironment\nmetadata:\n  name: team-dag-retained-inspect\nspec:\n  adapter: paseo\n  provider: opencode\n  modelPolicyRef: free-only\n  runtimeCellPolicy: per_runtime_session\n';
}
