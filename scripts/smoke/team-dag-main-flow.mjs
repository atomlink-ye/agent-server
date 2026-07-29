import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
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
const token = `team-dag-${randomUUID()}`;
const tenantId = 'tenant_team_dag_smoke';
const principalId = 'svc_team_dag_smoke';
const workspaceId = randomUUID();
const dbName = `agent_server_team_dag_${Date.now()}_${randomUUID().slice(0, 8)}`;
const runtimeRoot = join(
  root,
  '.local',
  'team-dag-smoke',
  `${process.pid}-${randomUUID().slice(0, 8)}`,
);
const projectCwd = join(runtimeRoot, 'project');
const cellRoot = join(runtimeRoot, 'cells');
let admin;
let db;
let paseo;
let api;
let service;
let apiUrl;

try {
  if (!adminUrl) throw new Error('missing_POSTGRES_ADMIN_URL');
  const adminParsed = new URL(adminUrl);
  if (adminParsed.hostname !== '127.0.0.1' || adminParsed.port !== '55433')
    throw new Error('unexpected_postgres_endpoint');
  admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${dbName.replaceAll('"', '""')}"`);
  const dbUrl = new URL(adminUrl);
  dbUrl.pathname = `/${dbName}`;
  db = new Client({ connectionString: dbUrl.toString() });
  await mkdir(projectCwd, { recursive: true });
  const paseoPort = await getAvailablePort();
  paseo = await startPaseo({
    repositoryRoot: root,
    runtimeRoot,
    port: paseoPort,
  });
  const apiPort = await getAvailablePort();
  process.env.NODE_ENV = 'test';
  process.env.HOST = '127.0.0.1';
  process.env.PORT = String(apiPort);
  process.env.DATABASE_URL = dbUrl.toString();
  process.env.POSTGRES_URL = process.env.DATABASE_URL;
  process.env.PASEO_WS_URL = paseo.wsUrl;
  process.env.PASEO_AGENT_CWD = projectCwd;
  process.env.PASEO_RUNTIME_CELL_ROOT = cellRoot;
  process.env.AGENT_SERVER_SKILL_REGISTRY_ROOT = join(runtimeRoot, 'skills');
  process.env.SERVICE_ACCOUNTS_JSON = JSON.stringify([
    {
      serviceAccountId: principalId,
      token,
      tenantId,
      workspaceId,
      policyVersion: 'team-dag-smoke-v1',
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
    [workspaceId, tenantId, 'service_account', principalId, 'Team DAG Smoke'],
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
  const ownerRows = await db.query(
    'SELECT id,status,tenant_id,workspace_id,principal_type,principal_id,managed_discriminator FROM agent_versions ORDER BY created_at',
  );
  if (ownerRows.rows?.length !== 3)
    throw new Error(`agent_seed_count:${ownerRows.rows?.length ?? 0}`);
  const definition = createTeamDefinition({
    ...owner,
    name: 'MVE Team DAG Smoke',
  });
  await invokables.saveTeamDefinition(definition);
  const draft = createDraftTeamVersion({
    ...owner,
    definitionId: definition.id,
    name: 'MVE Team DAG Smoke v1',
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
  const result = await poll(invoked.task_id);
  const tree = await request(`/api/v1/tasks/${invoked.task_id}/tree`, {
    method: 'GET',
    status: 200,
  });
  const children = tree.tasks.filter(
    (entry) => entry.task_id !== invoked.task_id,
  );
  if (children.length !== 3)
    throw new Error(`expected_three_children:${children.length}`);
  if (result.status !== 'completed')
    throw new Error(`root_not_completed:${result.status}`);
  console.log(
    JSON.stringify({
      status: 'passed',
      root_task: 'sanitized',
      child_tasks: 3,
      environment_version: 'shared',
      runtime_sessions: 'task-scoped',
      provider: 'free-only',
    }),
  );
} finally {
  await new Promise(
    (resolveClose) => api?.close?.(() => resolveClose()) ?? resolveClose(),
  ).catch(() => undefined);
  await service?.close?.().catch(() => undefined);
  await db?.end().catch(() => undefined);
  await admin
    ?.query(`DROP DATABASE IF EXISTS "${dbName.replaceAll('"', '""')}"`)
    .catch(() => undefined);
  await admin?.end().catch(() => undefined);
  await (paseo?.child ? stopProcessTree(paseo.child) : Promise.resolve()).catch(
    () => undefined,
  );
  await rm(runtimeRoot, { recursive: true, force: true }).catch(
    () => undefined,
  );
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
async function poll(taskId) {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    const task = await request(`/api/v1/tasks/${taskId}`, {
      method: 'GET',
      status: 200,
    });
    if (['completed', 'failed', 'cancelled'].includes(task.status)) return task;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
  }
  throw new Error('root_timeout');
}
function agentYaml(name, skill) {
  return `apiVersion: agent-server/v1alpha1\nkind: ManagedAgent\nmetadata:\n  name: ${name}\nspec:\n  description: Team DAG smoke agent\n  instructions: Return a concise factual result for the assigned research or synthesis task.\n  runtime:\n    provider: paseo\n    modelPolicyRef: free-only\n    mode: isolated\n  tools:\n    - ref: agent-server/memory-read\n      kind: tool\n  skills:\n    - ref: agent-server/memory-api\n  input:\n    schema:\n      type: object\n      properties: {}\n      additionalProperties: false\n    prompt: "Execute the assigned task."\n  session:\n    invocation: fresh_per_invocation\n    followUps: queued\n    binding: reusable\n  memory:\n    policy: workspace_snapshot\n    proposalLimit: 0\n  permissions:\n    network: read_only\n    filesystem: workspace_read\n  completion:\n    type: executable\n    command: "done"\n`;
}
function environmentYaml() {
  return 'apiVersion: agent-server/v1alpha1\nkind: ManagedEnvironment\nmetadata:\n  name: team-dag-smoke\nspec:\n  adapter: paseo\n  provider: opencode\n  modelPolicyRef: free-only\n  runtimeCellPolicy: per_runtime_session\n';
}
