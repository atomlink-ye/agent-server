import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
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

// The single Phase 2 acceptance path. There is deliberately no legacy fallback.
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const adminUrl = process.env.POSTGRES_ADMIN_URL;
const token = `phase2-${randomUUID()}`;
const tenantId = 'tenant_self_learning_phase2';
const principalId = 'svc_self_learning_phase2';
const workspaceId = randomUUID();
const dbName = `agent_server_phase2_${Date.now()}_${randomUUID().slice(0, 8)}`;
const runtimeRoot = join(
  root,
  '.local',
  'self-learning-team-phase2-smoke',
  `${process.pid}-${randomUUID().slice(0, 8)}`,
);
const projectCwd = join(runtimeRoot, 'project');
const cellRoot = join(runtimeRoot, 'cells');
const timeoutMs = Number(process.env.PHASE2_SMOKE_TIMEOUT_MS ?? '180000');
const pollMs = Number(process.env.PHASE2_SMOKE_POLL_MS ?? '300');
if (
  !Number.isFinite(timeoutMs) ||
  timeoutMs <= 0 ||
  !Number.isFinite(pollMs) ||
  pollMs <= 0
)
  throw new Error('invalid_phase2_poll_configuration');
const execFileAsync = promisify(execFile);
let admin, db, paseo, api, service, apiUrl;

try {
  if (!adminUrl) throw new Error('missing_POSTGRES_ADMIN_URL');
  admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${dbName.replaceAll('"', '""')}"`);
  const dbUrl = new URL(adminUrl);
  dbUrl.pathname = `/${dbName}`;
  db = new Client({ connectionString: dbUrl.toString() });
  await mkdir(runtimeRoot, { recursive: true });
  await runAgentctl([
    'init',
    projectCwd,
    '--template',
    'self-learning-market-research',
  ]);
  const useGo = Boolean(process.env.OPENCODE_GO_API_KEY);
  if (useGo)
    process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      provider: {
        'opencode-go': {
          npm: '@ai-sdk/openai-compatible',
          name: 'OpenCode Go',
          options: {
            baseURL: 'https://opencode.ai/zen/go/v1',
            apiKey: '{env:OPENCODE_GO_API_KEY}',
          },
          models: { 'deepseek-v4-flash': { name: 'deepseek-v4-flash' } },
        },
      },
    });
  paseo = await startPaseo({
    repositoryRoot: root,
    runtimeRoot,
    port: await getAvailablePort(),
    environmentVariableNames: useGo
      ? ['OPENCODE_GO_API_KEY', 'OPENCODE_CONFIG_CONTENT']
      : [],
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
        policyVersion: 'phase2-mve-v1',
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

  console.log('progress: init -> validate -> deterministic plan(no write)');
  await runAgentctl(['validate'], projectCwd);
  const beforePlan = await resourceCounts();
  const plan = await runAgentctl(['plan'], projectCwd);
  if (
    JSON.stringify(plan) !==
    JSON.stringify(await runAgentctl(['plan'], projectCwd))
  )
    throw new Error('plan_not_deterministic');
  if (JSON.stringify(beforePlan) !== JSON.stringify(await resourceCounts()))
    throw new Error('plan_wrote_resources');
  console.log('progress: apply -> reapply Lock stable');
  await runAgentctl(['apply'], projectCwd);
  const lockPath = join(projectCwd, 'agent-project.lock.json');
  const lockBytes = await readFile(lockPath);
  const lock = JSON.parse(lockBytes);
  if (
    /token|baseURL|runtimeRoot|source:|content:|prompt:|apiKey|\/(?:Users|Volumes)\//i.test(
      lockBytes.toString(),
    )
  )
    throw new Error('lock_contains_sensitive_or_absolute_data');
  const reapplied = await runAgentctl(['apply'], projectCwd);
  if (!reapplied.completed?.some((s) => ['Reuse', 'NoOp'].includes(s.outcome)))
    throw new Error('reapply_not_stable');
  if (Buffer.compare(lockBytes, await readFile(lockPath)) !== 0)
    throw new Error('lock_not_byte_stable');
  const store = lock.memoryStores.find((s) => s.ref === 'memory://research');
  const seed = store?.seeds?.find((s) => s.path === 'research/principles.md');
  if (!store?.id || !seed?.memoryId)
    throw new Error('resolved_memory_lock_missing');
  console.log(
    `progress: resolved memory store ${store.id.slice(0, 8)} target research/principles.md`,
  );
  const learnInput = JSON.stringify({
    mode: 'learn',
    memory_store_id: store.id,
    memory_path: seed.path,
    fixture_ref: 'fixture://self-learning-market-research/acme-v1',
    symbol: 'ACME',
    data_as_of: '2026-07-31',
    synthetic: true,
  });
  const recallInput = JSON.stringify({
    mode: 'recall',
    memory_store_id: store.id,
    memory_path: seed.path,
    fixture_ref: 'fixture://self-learning-market-research/acme-v1',
    symbol: 'ACME',
    data_as_of: '2026-07-31',
    synthetic: true,
  });
  const legacyBefore = await legacyProposalCount();
  console.log('progress: learn TeamRun -> synthetic MCP -> six-section report');
  const firstRootTaskId = (
    await runAgentctl(
      ['run', 'team://market-research', '--input', learnInput],
      projectCwd,
    )
  ).taskId;
  const firstTask = await pollTask(firstRootTaskId);
  if (firstTask.status !== 'completed')
    throw new Error(`learn_not_completed:${firstTask.status}`);
  const firstTeam = await request(`/api/v1/tasks/${firstRootTaskId}/team-run`, {
    status: 200,
  });
  const members = await request(`/api/v1/team-runs/${firstTeam.id}/members`, {
    status: 200,
  });
  if (
    firstTeam.status !== 'succeeded' ||
    firstTeam.phase !== 'done' ||
    members.length !== 3
  )
    throw new Error('learn_team_run_invalid');
  const tree = await request(`/api/v1/tasks/${firstRootTaskId}/tree`, {
    status: 200,
  });
  const reportRows = await db.query(
    'SELECT result FROM runs WHERE task_id=$1 OR task_id IN (SELECT id FROM tasks WHERE root_task_id=$1)',
    [firstRootTaskId],
  );
  const reportText = reportRows.rows
    .map((row) => JSON.stringify(row.result ?? ''))
    .join('\n');
  const missingSyntheticFacts = [
    '101.25',
    'product-update',
    'bounded-medium',
  ].filter((marker) => !reportText.includes(marker));
  if (
    !/synthetic demo only/i.test(reportText) ||
    ![
      'Scope',
      'Snapshot',
      'Events',
      'Opportunities',
      'Analog',
      'Learning loop',
    ].every((section) => new RegExp(section, 'i').test(reportText)) ||
    missingSyntheticFacts.length
  )
    throw new Error(
      `synthetic_report_marker_missing:${missingSyntheticFacts.join(',')}`,
    );
  const runs = await db.query(
    'SELECT id FROM runs WHERE task_id=$1 OR task_id IN (SELECT id FROM tasks WHERE root_task_id=$1)',
    [firstRootTaskId],
  );
  const proposalList = await request(
    `/api/v1/learning-proposals?workspace_id=${workspaceId}`,
    { status: 200 },
  );
  const proposals = proposalList.learning_proposals ?? [];
  if (proposals.length !== 1)
    throw new Error(`expected_one_pending_proposal:${proposals.length}`);
  const proposal = proposals[0];
  if (
    proposal.status !== 'pending' ||
    proposal.target.memory_store_id !== store.id ||
    proposal.target.path !== seed.path
  )
    throw new Error('proposal_target_invalid');
  console.log(
    'progress: proposal list/read -> human accept -> canonical Memory V2',
  );
  const readProposal = await request(
    `/api/v1/learning-proposals/${proposal.learning_proposal_id}`,
    { status: 200 },
  );
  if (
    readProposal.learning_proposal.learning_proposal_id !==
    proposal.learning_proposal_id
  )
    throw new Error('proposal_read_mismatch');
  const accepted = await request(
    `/api/v1/learning-proposals/${proposal.learning_proposal_id}/accept`,
    { method: 'POST', body: {}, status: 200 },
  );
  const acceptedProposal = accepted.learning_proposal;
  if (
    acceptedProposal.status !== 'accepted' ||
    !acceptedProposal.accepted_memory_version_id
  )
    throw new Error('proposal_accept_invalid');
  const memory = await request(
    `/api/v1/memory-stores/${store.id}/memories/${seed.memoryId}`,
    { status: 200 },
  );
  if (
    memory.memory.memory_version_id !==
      acceptedProposal.accepted_memory_version_id ||
    memory.memory.path !== seed.path
  )
    throw new Error('accepted_memory_version_mismatch');
  const versionCount = await db.query(
    'SELECT count(*)::int AS count FROM memory_versions WHERE memory_id=$1',
    [seed.memoryId],
  );
  console.log('progress: stale same-base proposal -> 409 -> pending -> reject');
  const staleId = randomUUID();
  const now = new Date().toISOString();
  await db.query(
    'INSERT INTO learning_proposals(id,tenant_id,workspace_id,principal_type,principal_id,source_team_run_id,source_task_id,source_run_id,target_memory_store_id,target_memory_id,target_path,base_content_sha256,proposed_content,evidence_refs,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)',
    [
      staleId,
      tenantId,
      workspaceId,
      'service_account',
      principalId,
      firstTeam.id,
      firstRootTaskId,
      runs.rows[0].id,
      store.id,
      seed.memoryId,
      seed.path,
      proposal.target.base_content_sha256,
      'stale controlled fixture proposal',
      JSON.stringify(['fixture://phase2/stale']),
      now,
    ],
  );
  await request(`/api/v1/learning-proposals/${staleId}/accept`, {
    method: 'POST',
    body: {},
    status: 409,
  });
  if (
    (await request(`/api/v1/learning-proposals/${staleId}`, { status: 200 }))
      .learning_proposal.status !== 'pending'
  )
    throw new Error('stale_proposal_not_pending');
  await request(`/api/v1/learning-proposals/${staleId}/reject`, {
    method: 'POST',
    body: {},
    status: 200,
  });
  if (
    (
      await db.query(
        'SELECT count(*)::int AS count FROM memory_versions WHERE memory_id=$1',
        [seed.memoryId],
      )
    ).rows[0].count !== versionCount.rows[0].count
  )
    throw new Error('stale_proposal_created_memory_version');
  console.log(
    'progress: independent recall TeamRun -> memory-read receipt -> applied principle',
  );
  const secondRootTaskId = (
    await runAgentctl(
      ['run', 'team://market-research', '--input', recallInput],
      projectCwd,
    )
  ).taskId;
  const secondTask = await pollTask(secondRootTaskId);
  if (secondTask.status !== 'completed')
    throw new Error(`recall_not_completed:${secondTask.status}`);
  const recallText = secondTask.result?.text ?? '';
  const secondTeam = await request(
    `/api/v1/tasks/${secondRootTaskId}/team-run`,
    { status: 200 },
  );
  if (secondTeam.id === firstTeam.id)
    throw new Error('team_run_ids_not_independent');
  const receipt = await db.query(
    "SELECT snapshot.tool_refs FROM runtime_sessions s JOIN session_launch_snapshots snapshot ON snapshot.id=s.launch_snapshot_id WHERE s.task_id IN (SELECT id FROM tasks WHERE root_task_id=$1) AND snapshot.tool_refs::text LIKE '%memory-read%'",
    [secondRootTaskId],
  );
  if (!receipt.rows.length) throw new Error('memory_read_receipt_missing');
  const allToolRefs = await db.query(
    'SELECT snapshot.tool_refs FROM runtime_sessions s JOIN session_launch_snapshots snapshot ON snapshot.id=s.launch_snapshot_id WHERE s.task_id IN (SELECT id FROM tasks WHERE root_task_id IN ($1,$2))',
    [firstRootTaskId, secondRootTaskId],
  );
  if (
    allToolRefs.rows.some((row) =>
      /memory[-_]write/i.test(JSON.stringify(row.tool_refs)),
    )
  )
    throw new Error('memory_write_grant_present');
  const finalMemory = await request(
    `/api/v1/memory-stores/${store.id}/memories/${seed.memoryId}`,
    { status: 200 },
  );
  if (
    finalMemory.memory.content_sha256 !== memory.memory.content_sha256 ||
    !finalMemory.memory.content
  )
    throw new Error('memory_content_receipt_invalid');
  const missingRecallEvidence = [
    seed.path,
    acceptedProposal.accepted_memory_version_id,
    finalMemory.memory.content_sha256,
  ].filter((marker) => !recallText.includes(marker));
  if (!/synthetic demo only/i.test(recallText))
    missingRecallEvidence.push('accepted_principle');
  if (!/appl(?:ied|ication)/i.test(recallText))
    missingRecallEvidence.push('application');
  if (missingRecallEvidence.length)
    throw new Error(
      `recall_report_did_not_apply_accepted_memory:${missingRecallEvidence.join(',')}`,
    );
  if ((await legacyProposalCount()) !== legacyBefore)
    throw new Error('legacy_workspace_proposal_count_changed');
  console.log(
    JSON.stringify({
      status: 'passed',
      synthetic_demo_only: true,
      phases: [
        'init',
        'validate',
        'plan(no-write)',
        'apply',
        'reapply(lock-stable)',
        'learn',
        'proposal-review',
        'stale-409-reject',
        'recall',
      ],
      team_run_ids_independent: true,
      accepted_memory_version_id: acceptedProposal.accepted_memory_version_id,
      memory_path: seed.path,
      memory_content_sha256: finalMemory.memory.content_sha256,
      no_memory_write_grant: true,
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
async function runAgentctl(args, cwd = root) {
  const command = args[0];
  const projectCommands = new Set(['validate', 'plan', 'apply', 'run']);
  const commandArgs = projectCommands.has(command)
    ? [...args, '--manifest', join(projectCwd, 'agent-project.yaml')]
    : args;
  const env = {
    ...process.env,
    AGENT_SERVER_SKILL_REGISTRY_ROOT: join(runtimeRoot, 'skills'),
  };
  if (new Set(['apply', 'run', 'watch']).has(command))
    Object.assign(env, {
      AGENT_SERVER_BASE_URL: apiUrl,
      AGENT_SERVER_TOKEN: token,
      AGENT_SERVER_WORKSPACE_ID: workspaceId,
    });
  const { stdout } = await execFileAsync(
    'pnpm',
    ['--dir', root, 'agentctl', ...commandArgs],
    { cwd, env, maxBuffer: 2 * 1024 * 1024 },
  );
  return JSON.parse(stdout.trim().split('\n').at(-1));
}
async function request(path, options = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body =
    response.status === 204 ? null : await response.json().catch(() => null);
  if (response.status !== options.status)
    throw new Error(
      `http_${response.status}_expected_${options.status}:${body?.error?.code ?? 'unknown'}`,
    );
  return body;
}
async function pollTask(id) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    const task = await request(`/api/v1/tasks/${id}`, { status: 200 });
    if (task.status !== last) {
      console.log(`progress: task ${id.slice(0, 8)} ${task.status}`);
      last = task.status;
    }
    if (['completed', 'failed', 'cancelled'].includes(task.status)) return task;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error('phase2_smoke_timeout');
}
async function resourceCounts() {
  const counts = {};
  for (const table of [
    'workspaces',
    'agent_definitions',
    'environment_definitions',
    'team_definitions',
    'memory_stores',
  ])
    counts[table] = (
      await db.query(`SELECT count(*)::int AS count FROM ${table}`)
    ).rows[0].count;
  return counts;
}
async function legacyProposalCount() {
  return (
    await db
      .query(
        'SELECT count(*)::int AS count FROM workspace_memory_proposals WHERE workspace_id=$1',
        [workspaceId],
      )
      .catch(() => ({ rows: [{ count: 0 }] }))
  ).rows[0].count;
}
