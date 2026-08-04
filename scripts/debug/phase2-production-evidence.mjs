import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { register as registerTsx } from 'tsx/esm/api';
import { Client } from 'pg';

registerTsx();

import { ResolveAgentVersion } from '../../src/application/agents/resolve-agent-version.ts';
import { AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS } from '../../src/application/agents/built-in-skills.ts';
import { RuntimeToolGrantService } from '../../src/application/extensions/runtime-tool-grant-service.ts';
import { ClaimNextRun } from '../../src/application/runs/claim-next-run.ts';
import { CompleteRun } from '../../src/application/runs/complete-run.ts';
import { ExecuteRun } from '../../src/application/runs/execute-run.ts';
import { ExecuteTeamTask } from '../../src/application/tasks/execute-team-task.ts';
import { encodeRootTaskRunRequestSnapshotRef } from '../../src/application/tasks/root-task-input.ts';
import { TeamCommandService } from '../../src/application/teams/team-command-service.ts';
import {
  deriveTeamContextEpoch,
  TeamToolContextResolver,
} from '../../src/application/teams/team-tool-context.ts';
import { TeamPolicyEvaluator } from '../../src/application/teams/team-policy-evaluator.ts';
import { TeamToolHandler } from '../../src/application/teams/team-tools.ts';
import { TeamWakeReconciler } from '../../src/application/teams/team-wake-reconciler.ts';
import { createAgentDefinition } from '../../src/domain/invokables/agent-definition.ts';
import {
  createDraftAgentVersion,
  publishAgentVersion,
} from '../../src/domain/invokables/agent-version.ts';
import { createRun } from '../../src/domain/runs/run.ts';
import {
  createChildTask,
  createRootTask,
  rehydrateTask,
  transitionTask,
} from '../../src/domain/tasks/task.ts';
import {
  activateMemberRun,
  createTeamMemberRun,
} from '../../src/domain/teams/team-member-run.ts';
import { createTeamRun } from '../../src/domain/teams/team-run.ts';
import { LocalSkillCatalog } from '../../src/infrastructure/filesystem/local-skill-catalog.ts';
import { LocalRuntimeExtensionBinder } from '../../src/infrastructure/extensions/local-runtime-extension-binder.ts';
import { RuntimeMcpServer } from '../../src/infrastructure/extensions/runtime-mcp-server.ts';
import { PostgresAdmissionRepository } from '../../src/infrastructure/postgres/postgres-admission-repository.ts';
import { PostgresAgentRegistry } from '../../src/infrastructure/postgres/postgres-agent-registry.ts';
import { PostgresInvokableRepository } from '../../src/infrastructure/postgres/postgres-invokable-repository.ts';
import { PostgresMemoryApiRepository } from '../../src/infrastructure/postgres/postgres-memory-api-repository.ts';
import {
  applyDurableKernelMigrations,
  createPostgresPool,
} from '../../src/infrastructure/postgres/postgres.ts';
import { PostgresRunDispatcher } from '../../src/infrastructure/postgres/postgres-run-dispatcher.ts';
import { PostgresRunEventRepository } from '../../src/infrastructure/postgres/postgres-run-event-repository.ts';
import { PostgresRunRepository } from '../../src/infrastructure/postgres/postgres-run-repository.ts';
import { PostgresTaskRepository } from '../../src/infrastructure/postgres/postgres-task-repository.ts';
import { PostgresTeamExecutionRepository } from '../../src/infrastructure/postgres/postgres-collaborative-team-repository.ts';
import { PostgresTeamMessageRepository } from '../../src/infrastructure/postgres/postgres-team-message-repository.ts';
import { createLogger } from '../../src/shared/observability/logger.ts';

const repositoryRoot = resolve(
  fileURLToPath(new URL('../..', import.meta.url)),
);
const adminUrl = process.env.POSTGRES_ADMIN_URL;
const suffix = randomUUID().slice(0, 8);
const timestamp = Date.now();
const startedAtMs = timestamp;
const outerTimeoutSeconds = Number(
  process.env.PHASE2_EVIDENCE_OUTER_TIMEOUT_SECONDS ?? '0',
);
const databaseName = 'agent_server_phase2_cd_' + timestamp + '_' + suffix;
const evidenceName = 'phase2-cd-' + timestamp + '-' + suffix;
const evidenceRoot = join(repositoryRoot, '.local', evidenceName);
const runtimeRoot = join(evidenceRoot, 'runtime');
const projectCwd = join(runtimeRoot, 'project');
const registryRoot = join(runtimeRoot, 'skills');
const manifestPath = join(evidenceRoot, 'manifest.json');
const stdoutPath = join(evidenceRoot, 'stdout.ndjson');
const stderrPath = join(evidenceRoot, 'stderr.ndjson');
const markers = [];
const stdout = [];
const stderr = [];
const dispatcherLogs = [];
const ids = {};
let admin;
let pool;
let composition;
let databaseUrl;

await mkdir(projectCwd, { recursive: true });
await mkdir(registryRoot, { recursive: true });
await chmod(evidenceRoot, 0o700);

function assertion(condition, code) {
  if (!condition) throw new Error(code);
}

function safe(value) {
  if (Array.isArray(value)) return value.map(safe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        /^(?:authorization|bearer|token|secret|password|api.?key|prompt|systemPrompt|content|body)$/iu.test(
          key,
        )
          ? '[redacted]'
          : safe(entry),
      ]),
    );
  }
  if (typeof value !== 'string') return value;
  return value
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\/(?:Users|Volumes)\/[^\s"]+/gu, '[path]')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 2048);
}

function marker(name, fields = {}) {
  const entry = safe({
    marker: name,
    at: new Date().toISOString(),
    database_name: databaseName,
    ids,
    ...fields,
  });
  markers.push(entry);
  const line = JSON.stringify(entry);
  stdout.push(line);
  process.stdout.write(line + '\n');
}

function errorLine(error) {
  const entry = safe({
    error: error instanceof Error ? error.message : 'unknown_error',
  });
  const line = JSON.stringify(entry);
  stderr.push(line);
  process.stderr.write(line + '\n');
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function owner() {
  return {
    tenantId: 'tenant_phase2_cd',
    workspaceId: ids.workspace_id,
    principalType: 'service_account',
    principalId: 'svc_phase2_cd',
  };
}

async function seedPublishedAgent(invokables) {
  const created = new Date(Date.now() - 2_000);
  const published = new Date(Date.now() - 1_000);
  const definition = createAgentDefinition({
    id: randomUUID(),
    ...owner(),
    name: 'Phase 2 Deterministic Member',
    description: 'Fixture-only published Agent prerequisite.',
    now: () => created,
  });
  const version = publishAgentVersion(
    createDraftAgentVersion({
      id: randomUUID(),
      definitionId: definition.id,
      ...owner(),
      name: 'Phase 2 Deterministic Member v1',
      description: 'Fixture-only published Agent prerequisite.',
      instructions:
        'Complete the assigned Team work using canonical Team tools.',
      now: () => created,
    }),
    () => published,
  );
  await invokables.saveAgentDefinition(definition);
  await invokables.saveAgentVersion(version);
  ids.agent_version_id = version.id;
  return version;
}

function runtimeFrom(grants, contextResolver, commands) {
  return {
    async initialize() {},
    async health() {
      return {
        ready: true,
        provider: 'deterministic-fixture',
        model: 'model-substitute',
        checks: [{ name: 'deterministic_fixture', ready: true }],
      };
    },
    async execute(input) {
      assertion(
        input.operation === 'create',
        'unexpected_runtime_continuation',
      );
      const authorization =
        input.extensions?.mcpServers?.[0]?.headers?.Authorization;
      assertion(
        typeof authorization === 'string' &&
          authorization.startsWith('Bearer '),
        'runtime_bearer_missing',
      );
      const grant = grants.resolve(authorization.slice('Bearer '.length));
      assertion(grant, 'runtime_grant_unresolvable');
      const context = await contextResolver.resolve(grant);
      assertion(context.run.id === input.runId, 'runtime_context_run_mismatch');
      assertion(context.member.role === 'member', 'runtime_context_not_member');
      await commands.submit(context, {
        summary: 'Deterministic member result for durable wake evidence.',
      });
      marker('RUNTIME_CANONICAL_SUBMIT', {
        pre: {
          run_status: context.run.status,
          task_status: context.task.status,
        },
        expected: { role: 'member', canonical_submit: true },
        actual: {
          role: context.member.role,
          task_id: context.task.id,
          run_id: context.run.id,
          member_id: context.member.id,
          canonical_submit: true,
        },
      });
      return {
        provider: 'deterministic-fixture',
        model: 'model-substitute',
        providerAgentId: 'fixture-' + input.runId,
        text: 'Deterministic runtime completed after canonical submit.',
        usage: { inputTokens: 1, outputTokens: 1, totalCostUsd: 0 },
      };
    },
    async close() {},
  };
}

function buildComposition(databasePool) {
  const tasks = new PostgresTaskRepository(databasePool);
  const runs = new PostgresRunRepository(databasePool);
  const admission = new PostgresAdmissionRepository(databasePool);
  const executions = new PostgresTeamExecutionRepository(databasePool);
  const messages = new PostgresTeamMessageRepository(databasePool);
  const events = new PostgresRunEventRepository(databasePool);
  const invokables = new PostgresInvokableRepository(databasePool);
  const commands = new TeamCommandService(executions, events);
  const contextResolver = new TeamToolContextResolver(
    executions,
    tasks,
    runs,
    new TeamPolicyEvaluator(),
  );
  const grants = new RuntimeToolGrantService();
  const logger = createLogger({
    service: 'phase2-production-evidence',
    minimumLevel: 'debug',
    write: (line) => {
      try {
        dispatcherLogs.push(safe(JSON.parse(line)));
      } catch {
        dispatcherLogs.push(safe(line));
      }
    },
  });
  const mcp = new RuntimeMcpServer(
    new PostgresMemoryApiRepository(databasePool),
    grants,
    {
      handler: new TeamToolHandler(executions, runs, tasks, events),
      contextResolver,
      commands,
    },
    undefined,
    undefined,
    logger,
  );
  const binder = new LocalRuntimeExtensionBinder(projectCwd, registryRoot, mcp);
  const runtime = runtimeFrom(grants, contextResolver, commands);
  const completeRun = new CompleteRun(runs, tasks, events);
  const executeTeamTask = new ExecuteTeamTask(
    tasks,
    runs,
    invokables,
    runtime,
    completeRun,
  );
  const agentResolver = new ResolveAgentVersion(
    new PostgresAgentRegistry(databasePool),
    invokables,
    new LocalSkillCatalog(registryRoot),
  );
  const executeRun = new ExecuteRun(
    completeRun,
    tasks,
    invokables,
    executeTeamTask,
    runtime,
    logger,
    undefined,
    agentResolver,
    events,
    undefined,
    undefined,
    binder,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    executions,
    runs,
  );
  const dispatcher = new PostgresRunDispatcher(
    new ClaimNextRun(runs, {
      workerId: 'phase2-evidence-' + process.pid,
      leaseDurationMs: 60_000,
    }),
    executeRun,
    logger,
    { pollIntervalMs: 5, concurrency: 1 },
  );
  const reconciler = new TeamWakeReconciler(
    messages,
    executions,
    tasks,
    admission,
  );
  return {
    tasks,
    runs,
    admission,
    executions,
    messages,
    events,
    invokables,
    commands,
    contextResolver,
    grants,
    mcp,
    binder,
    runtime,
    dispatcher,
    reconciler,
  };
}

function grantFromBinding(binding, grants) {
  const authorization = binding?.mcpServers?.[0]?.headers?.Authorization;
  assertion(
    typeof authorization === 'string' && authorization.startsWith('Bearer '),
    'lead_bearer_missing',
  );
  const grant = grants.resolve(authorization.slice('Bearer '.length));
  assertion(grant, 'lead_grant_unresolvable');
  return grant;
}

async function messageForAttempt(databasePool, attemptId) {
  const result = await databasePool.query(
    'SELECT id,team_run_id,sequence,sender_member_run_id,recipient_member_run_id,work_item_id,attempt_id,kind,dedup_key,body,status,consumed_by_task_id,created_at,consumed_at FROM team_messages WHERE attempt_id=$1',
    [attemptId],
  );
  assertion(result.rows.length === 1, 'attempt_message_cardinality_invalid');
  const row = result.rows[0];
  return {
    ...row,
    body_hash: sha256(row.body),
    body_length: row.body.length,
    body: undefined,
  };
}

async function attemptByNumber(databasePool, teamRunId, number) {
  const result = await databasePool.query(
    'SELECT id,work_item_id,team_run_id,attempt_no,assignee_member_id,requested_by_lead_task_id,feedback,status,execution_task_id,result_summary FROM team_work_item_attempts WHERE team_run_id=$1 AND attempt_no=$2',
    [teamRunId, number],
  );
  assertion(result.rows.length === 1, 'attempt_number_cardinality_invalid');
  return result.rows[0];
}

async function memberActivity(databasePool, rootTaskId, memberId) {
  const result = await databasePool.query(
    "SELECT m.status AS member_status,(SELECT count(*)::int FROM tasks t WHERE t.root_task_id=$2 AND t.team_member_run_id=$1 AND t.status NOT IN ('completed','failed','cancelled')) AS active_tasks,(SELECT count(*)::int FROM team_work_item_attempts a WHERE a.assignee_member_id=$1 AND a.status IN ('queued','running')) AS active_attempts FROM team_member_runs m WHERE m.id=$1",
    [memberId, rootTaskId],
  );
  assertion(result.rows.length === 1, 'member_activity_cardinality_invalid');
  return result.rows[0];
}

function assertMessageEnvelope(message, input) {
  assertion(
    message.sender_member_run_id === input.senderMemberId,
    'message_sender_mismatch',
  );
  assertion(
    message.recipient_member_run_id === input.recipientMemberId,
    'message_recipient_mismatch',
  );
  assertion(message.kind === 'wake', 'message_kind_not_safe_wake');
  assertion(
    typeof message.dedup_key === 'string' &&
      message.dedup_key.startsWith(
        'member:' + input.recipientMemberId + ':wake:',
      ),
    'message_dedup_key_invalid',
  );
  assertion(message.body_length > 0, 'message_body_empty');
}

async function boundState(databasePool, messageId) {
  const result = await databasePool.query(
    "SELECT m.id AS message_id,m.status AS message_status,m.consumed_by_task_id,m.kind,m.dedup_key,m.sender_member_run_id,m.recipient_member_run_id,m.attempt_id,t.id AS task_id,t.status AS task_status,t.source_team_message_id,t.input_team_message_ids,r.id AS run_id,r.status AS run_status,d.id::text AS dispatch_id,d.published_at FROM team_messages m LEFT JOIN tasks t ON t.source_team_message_id=m.id LEFT JOIN runs r ON r.task_id=t.id LEFT JOIN run_dispatches d ON d.run_id=r.id AND d.event_type='run.enqueue' WHERE m.id=$1 ORDER BY d.id NULLS LAST",
    [messageId],
  );
  assertion(result.rows.length === 1, 'bound_state_cardinality_invalid');
  return result.rows[0];
}

async function exactCounts(databasePool, messageId) {
  const result = await databasePool.query(
    "SELECT (SELECT count(*)::int FROM team_messages WHERE id=$1) AS messages,(SELECT count(*)::int FROM tasks WHERE source_team_message_id=$1) AS tasks,(SELECT count(*)::int FROM runs r JOIN tasks t ON t.id=r.task_id WHERE t.source_team_message_id=$1) AS runs,(SELECT count(*)::int FROM run_dispatches d JOIN runs r ON r.id=d.run_id JOIN tasks t ON t.id=r.task_id WHERE t.source_team_message_id=$1 AND d.event_type='run.enqueue') AS dispatches",
    [messageId],
  );
  return result.rows[0];
}

async function waitForRun(databasePool, runId, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    const result = await databasePool.query(
      'SELECT status,error FROM runs WHERE id=$1',
      [runId],
    );
    last = result.rows[0];
    if (
      last &&
      ['succeeded', 'failed', 'timed_out', 'cancelled'].includes(last.status)
    )
      return last;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error(
    'run_terminal_timeout:' +
      JSON.stringify(
        safe({
          run_id: runId,
          last,
          dispatcher_logs: dispatcherLogs.slice(-8),
        }),
      ),
  );
}

async function executeBoundMessage(comp, databasePool, messageId) {
  const before = await boundState(databasePool, messageId);
  assertion(
    before.message_status === 'consumed',
    'message_not_consumed_before_dispatch',
  );
  assertion(before.task_status === 'queued', 'bound_task_not_queued');
  assertion(before.run_status === 'queued', 'bound_run_not_queued');
  assertion(before.published_at === null, 'dispatch_published_too_early');
  comp.dispatcher.start();
  let terminal;
  try {
    terminal = await waitForRun(databasePool, before.run_id);
  } finally {
    await comp.dispatcher.stop();
  }
  const after = await boundState(databasePool, messageId);
  assertion(terminal.status === 'succeeded', 'bound_run_not_succeeded');
  assertion(after.task_status === 'completed', 'bound_task_not_completed');
  assertion(after.run_status === 'succeeded', 'bound_run_state_not_succeeded');
  assertion(after.published_at !== null, 'dispatch_not_published');
  return after;
}

async function writeEvidence() {
  const manifest = safe({
    schema: 'agent-teams-v2-phase2-cd-v2',
    result: markers.at(-1)?.marker === 'RESULT_PASS' ? 'passed' : 'blocked',
    database_name: databaseName,
    evidence_name: evidenceName,
    node_version: process.version,
    execution: {
      outer_timeout_seconds: outerTimeoutSeconds,
      command:
        'timeout ' +
        outerTimeoutSeconds +
        's node --import tsx scripts/debug/phase2-production-evidence.mjs',
      expected_exit_code: 0,
      process_exit_code: process.exitCode ?? 0,
      elapsed_ms: Date.now() - startedAtMs,
    },
    ids,
    markers,
    dispatcher_logs: dispatcherLogs,
    stdout_file: 'stdout.ndjson',
    stderr_file: 'stderr.ndjson',
    credentials: '[absent]',
    prompts: '[absent]',
  });
  await writeFile(stdoutPath, stdout.join('\n') + '\n', { mode: 0o600 });
  await writeFile(stderrPath, stderr.join('\n') + (stderr.length ? '\n' : ''), {
    mode: 0o600,
  });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', {
    mode: 0o600,
  });
  await Promise.all([
    chmod(stdoutPath, 0o600),
    chmod(stderrPath, 0o600),
    chmod(manifestPath, 0o600),
  ]);
}

try {
  assertion(
    Number.isInteger(outerTimeoutSeconds) && outerTimeoutSeconds >= 1,
    'missing_or_invalid_outer_timeout',
  );
  assertion(adminUrl, 'missing_POSTGRES_ADMIN_URL');
  admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(
    'CREATE DATABASE "' + databaseName.replaceAll('"', '""') + '"',
  );
  const parsed = new URL(adminUrl);
  parsed.pathname = '/' + databaseName;
  databaseUrl = parsed.toString();
  pool = createPostgresPool({
    connectionString: databaseUrl,
    maxConnections: 6,
  });
  await applyDurableKernelMigrations(pool);
  ids.workspace_id = randomUUID();

  const migrations = await pool.query(
    'SELECT version FROM durable_kernel_schema_migrations ORDER BY version',
  );
  marker('FRESH_DATABASE_MIGRATED', {
    pre: { database_existed: false },
    expected: { migration: '0024_agent_team_messages' },
    actual: {
      node_version: process.version,
      migration_count: migrations.rows.length,
      latest_migration: migrations.rows.at(-1)?.version,
    },
  });

  composition = buildComposition(pool);
  const agent = await seedPublishedAgent(composition.invokables);
  const fixtureOwner = owner();
  const rootTask = createRootTask({
    ...fixtureOwner,
    id: randomUUID(),
    policySnapshotVersion: 'phase2-cd-v1',
    invokableKind: 'team',
    invokableVersionId: randomUUID(),
    inputSnapshotRef: encodeRootTaskRunRequestSnapshotRef({
      prompt: 'Fixture Team root.',
    }),
    inputFingerprint: 'phase2-cd-fixture',
    ingress: 'api',
    originRef: null,
  });
  const rootRun = createRun('Fixture Team root.');
  ids.root_task_id = rootTask.id;
  ids.root_run_id = rootRun.id;
  await composition.tasks.save(rootTask);
  await composition.runs.save(rootRun, { taskId: rootTask.id, attempt: 1 });

  const team = createTeamRun({
    ...fixtureOwner,
    rootTaskId: rootTask.id,
    rootRunId: rootRun.id,
    teamVersionId: rootTask.invokableVersionId,
    environmentVersionId: randomUUID(),
    executionMode: 'agentic_mve',
    initialLeadTurn: true,
  });
  const lead = activateMemberRun(
    createTeamMemberRun({
      ...fixtureOwner,
      teamRunId: team.id,
      name: 'lead',
      role: 'lead',
      agentVersionId: agent.id,
    }),
  );
  const member = createTeamMemberRun({
    ...fixtureOwner,
    teamRunId: team.id,
    name: 'member',
    role: 'member',
    agentVersionId: agent.id,
  });
  ids.team_run_id = team.id;
  ids.lead_member_id = lead.id;
  ids.member_id = member.id;
  await composition.executions.createTeamRun(team);
  await composition.executions.createMemberRun(lead);
  await composition.executions.createMemberRun(member);

  const leadTask = createChildTask({
    ...fixtureOwner,
    policySnapshotVersion: rootTask.policySnapshotVersion,
    rootTaskId: rootTask.id,
    parentTaskId: rootTask.id,
    parentRunId: rootRun.id,
    invokableKind: 'agent',
    invokableVersionId: agent.id,
    inputSnapshotRef: encodeRootTaskRunRequestSnapshotRef({
      prompt: 'Fixture Lead source turn.',
    }),
    inputFingerprint: rootTask.inputFingerprint,
    logicalStepKey: 'lead:' + team.id + ':' + lead.id + ':turn:1',
    nodePath: 'lead:' + team.id + ':' + lead.id + ':turn:1',
    teamMemberRunId: lead.id,
    teamSequence: 1,
    teamTaskKind: 'lead_turn',
  });
  const leadRun = createRun('Fixture Lead source turn.');
  ids.lead_task_id = leadTask.id;
  ids.lead_run_id = leadRun.id;
  await composition.admission.withTransaction(async (transaction) => {
    await transaction.tasks.save(leadTask);
    await transaction.runs.save(leadRun, { taskId: leadTask.id, attempt: 1 });
    await transaction.enqueueRunDispatch(leadRun.id, leadRun.createdAt);
  });
  const leadClaim = await new ClaimNextRun(composition.runs, {
    workerId: 'phase2-lead-setup-' + process.pid,
    leaseDurationMs: 120_000,
  }).execute();
  assertion(leadClaim?.run.id === leadRun.id, 'lead_claim_not_exact');
  await composition.tasks.save(
    transitionTask(leadTask, 'active', () => new Date(leadClaim.run.updatedAt)),
  );
  const leadDispatch = await pool.query(
    'SELECT published_at FROM run_dispatches WHERE run_id=$1',
    [leadRun.id],
  );
  assertion(leadDispatch.rows[0]?.published_at, 'lead_dispatch_not_published');

  const leadBinding = await composition.binder.bind({
    ...fixtureOwner,
    scopeId: lead.id,
    taskId: leadTask.id,
    runId: leadRun.id,
    teamMemberRunId: lead.id,
    contextEpoch: deriveTeamContextEpoch(leadTask.id, leadRun.id),
    skills: [],
    toolRefs: Object.values(AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS),
  });
  const leadGrant = grantFromBinding(leadBinding, composition.grants);
  const leadContext = await composition.contextResolver.resolve(leadGrant);
  marker('LEAD_SOURCE_BOUND', {
    pre: { task_status: 'active', run_status: 'running' },
    expected: { real_binder: true, real_context_resolver: true },
    actual: {
      task_id: leadContext.task.id,
      run_id: leadContext.run.id,
      member_id: leadContext.member.id,
      role: leadContext.member.role,
      real_binder: true,
      real_context_resolver: true,
    },
  });

  const createdWork = await composition.commands.createWork(leadContext, {
    subject: 'Durable wake evidence',
    description: 'Complete the bounded deterministic Phase 2 evidence.',
    assignee: member.name,
  });
  const attempt1 = await attemptByNumber(pool, team.id, 1);
  const message1 = await messageForAttempt(pool, attempt1.id);
  ids.work_item_id = attempt1.work_item_id;
  ids.attempt1_id = attempt1.id;
  ids.message1_id = message1.id;
  assertion(message1.status === 'queued', 'attempt1_message_not_queued');
  assertMessageEnvelope(message1, {
    senderMemberId: lead.id,
    recipientMemberId: member.id,
  });
  const reconcile1 = await composition.reconciler.reconcileForRootTask(
    rootTask.id,
    fixtureOwner,
  );
  assertion(reconcile1 === 1, 'attempt1_reconcile_not_one');
  const attempt1Terminal = await executeBoundMessage(
    composition,
    pool,
    message1.id,
  );
  ids.attempt1_task_id = attempt1Terminal.task_id;
  ids.attempt1_run_id = attempt1Terminal.run_id;
  const attempt1After = await attemptByNumber(pool, team.id, 1);
  assertion(attempt1After.status === 'completed', 'attempt1_not_completed');
  marker('ATTEMPT1_PRODUCTION_PATH_TERMINAL', {
    pre: {
      message_status: 'queued',
      body_hash: message1.body_hash,
      body_length: message1.body_length,
      sender_member_run_id: message1.sender_member_run_id,
      recipient_member_run_id: message1.recipient_member_run_id,
      kind: message1.kind,
      dedup_key: message1.dedup_key,
    },
    expected: {
      reconcile_count: 1,
      task_status: 'completed',
      run_status: 'succeeded',
      attempt_status: 'completed',
      dispatch_published: true,
    },
    actual: {
      work_ref: createdWork.work_ref,
      message_id: message1.id,
      task_id: attempt1Terminal.task_id,
      run_id: attempt1Terminal.run_id,
      dispatch_id: attempt1Terminal.dispatch_id,
      message_status: attempt1Terminal.message_status,
      task_status: attempt1Terminal.task_status,
      run_status: attempt1Terminal.run_status,
      attempt_status: attempt1After.status,
      dispatch_published: attempt1Terminal.published_at !== null,
    },
  });

  const refreshedLeadContext =
    await composition.contextResolver.resolve(leadGrant);
  const requestInput = {
    workRef: createdWork.work_ref,
    assignee: member.name,
    feedback:
      'Provide one concise corrected result for the durable wake proof.',
  };
  const rework = await composition.commands.requestChanges(
    refreshedLeadContext,
    requestInput,
  );
  const attempt2BeforeReplay = await attemptByNumber(pool, team.id, 2);
  const message2BeforeReplay = await messageForAttempt(
    pool,
    attempt2BeforeReplay.id,
  );
  assertMessageEnvelope(message2BeforeReplay, {
    senderMemberId: lead.id,
    recipientMemberId: member.id,
  });
  const countsBeforeReplay = await exactCounts(pool, message2BeforeReplay.id);
  const replay = await composition.commands.requestChanges(
    refreshedLeadContext,
    requestInput,
  );
  const attempt2 = await attemptByNumber(pool, team.id, 2);
  const message2 = await messageForAttempt(pool, attempt2.id);
  ids.attempt2_id = attempt2.id;
  ids.message2_id = message2.id;
  const queuedCounts = await exactCounts(pool, message2.id);
  const activityAfterAttempt1 = await memberActivity(
    pool,
    rootTask.id,
    member.id,
  );
  assertion(message2.status === 'queued', 'attempt2_message_not_queued');
  assertion(
    message2.consumed_by_task_id === null,
    'attempt2_message_bound_too_early',
  );
  assertion(queuedCounts.messages === 1, 'attempt2_message_duplicate');
  assertion(queuedCounts.tasks === 0, 'attempt2_task_created_before_resume');
  assertion(
    attempt2.id === attempt2BeforeReplay.id &&
      message2.id === message2BeforeReplay.id &&
      message2.dedup_key === message2BeforeReplay.dedup_key &&
      message2.body_hash === message2BeforeReplay.body_hash &&
      message2.status === message2BeforeReplay.status &&
      JSON.stringify(queuedCounts) === JSON.stringify(countsBeforeReplay),
    'request_changes_replay_mutated_message',
  );
  assertion(
    activityAfterAttempt1.member_status === 'idle' &&
      activityAfterAttempt1.active_tasks === 0 &&
      activityAfterAttempt1.active_attempts === 1,
    'attempt2_queued_prestate_invalid',
  );
  assertion(
    JSON.stringify(rework) === JSON.stringify(replay),
    'request_changes_replay_changed_result',
  );
  marker('ATTEMPT2_DURABLE_QUEUED_AND_REPLAYED', {
    pre: {
      attempt1_status: attempt1After.status,
      member_status: activityAfterAttempt1.member_status,
      active_member_tasks: activityAfterAttempt1.active_tasks,
      active_member_attempts: activityAfterAttempt1.active_attempts,
      message_id_before_replay: message2BeforeReplay.id,
      dedup_key_before_replay: message2BeforeReplay.dedup_key,
      body_hash_before_replay: message2BeforeReplay.body_hash,
      message_status_before_replay: message2BeforeReplay.status,
      counts_before_replay: countsBeforeReplay,
    },
    expected: {
      message_status: 'queued',
      consumed_by_task_id: null,
      replay_same_result: true,
      replay_message_immutable: true,
      message_count: 1,
      task_count: 0,
    },
    actual: {
      attempt2_id: attempt2.id,
      message_id: message2.id,
      message_status: message2.status,
      consumed_by_task_id: message2.consumed_by_task_id,
      replay_same_result: JSON.stringify(rework) === JSON.stringify(replay),
      replay_message_immutable:
        message2.id === message2BeforeReplay.id &&
        message2.dedup_key === message2BeforeReplay.dedup_key &&
        message2.body_hash === message2BeforeReplay.body_hash &&
        message2.status === message2BeforeReplay.status &&
        JSON.stringify(queuedCounts) === JSON.stringify(countsBeforeReplay),
      counts: queuedCounts,
      body_hash: message2.body_hash,
      body_length: message2.body_length,
      sender_member_run_id: message2.sender_member_run_id,
      recipient_member_run_id: message2.recipient_member_run_id,
      kind: message2.kind,
      dedup_key: message2.dedup_key,
    },
  });

  await composition.dispatcher.stop();
  await composition.mcp.stop();
  await pool.end();
  pool = undefined;
  composition = undefined;
  marker('COMPONENTS_PAUSED_WITH_DURABLE_WAKE', {
    pre: { message_status: 'queued', consumed_by_task_id: null },
    expected: {
      pool_closed: true,
      provider_session_recovery_claimed: false,
    },
    actual: {
      pool_closed: true,
      provider_session_recovery_claimed: false,
      recovery_scope: 'component_startup_rebuild_from_postgres',
    },
  });

  pool = createPostgresPool({
    connectionString: databaseUrl,
    maxConnections: 6,
  });
  composition = buildComposition(pool);
  const resumed = await composition.reconciler.reconcileQueuedWakeRoots();
  const resumedAgain = await composition.reconciler.reconcileQueuedWakeRoots();
  assertion(resumed === 1, 'startup_reconcile_not_one');
  assertion(resumedAgain === 0, 'second_startup_reconcile_not_zero');
  const resumedState = await boundState(pool, message2.id);
  const resumedCounts = await exactCounts(pool, message2.id);
  assertion(
    resumedState.message_status === 'consumed',
    'resumed_message_not_consumed',
  );
  assertion(resumedState.task_status === 'queued', 'resumed_task_not_queued');
  assertion(resumedState.run_status === 'queued', 'resumed_run_not_queued');
  assertion(resumedCounts.tasks === 1, 'resumed_task_count_not_one');
  assertion(resumedCounts.runs === 1, 'resumed_run_count_not_one');
  assertion(resumedCounts.dispatches === 1, 'resumed_dispatch_count_not_one');
  ids.attempt2_task_id = resumedState.task_id;
  ids.attempt2_run_id = resumedState.run_id;
  marker('STARTUP_REBUILD_FROM_QUEUED_MESSAGE', {
    pre: { persisted_message_status: 'queued', fresh_components: true },
    expected: {
      first_reconcile: 1,
      second_reconcile: 0,
      message_status: 'consumed',
      task_status: 'queued',
      run_status: 'queued',
    },
    actual: {
      first_reconcile: resumed,
      second_reconcile: resumedAgain,
      message_id: resumedState.message_id,
      task_id: resumedState.task_id,
      run_id: resumedState.run_id,
      dispatch_id: resumedState.dispatch_id,
      message_status: resumedState.message_status,
      task_status: resumedState.task_status,
      run_status: resumedState.run_status,
      counts: resumedCounts,
      recovery_scope: 'component_startup_rebuild_from_postgres',
    },
  });

  const attempt2Terminal = await executeBoundMessage(
    composition,
    pool,
    message2.id,
  );
  const attempt2After = await attemptByNumber(pool, team.id, 2);
  const memberAfter = await composition.executions.findMemberRunById(
    member.id,
    fixtureOwner,
  );
  assertion(attempt2After.status === 'completed', 'attempt2_not_completed');
  assertion(memberAfter?.status === 'idle', 'member_not_idle_after_attempt2');

  const countsBeforeForgery = await exactCounts(pool, message2.id);
  const boundTask = await composition.tasks.findById(attempt2Terminal.task_id);
  assertion(boundTask, 'attempt2_bound_task_missing');
  assertion(
    boundTask.sourceTeamMessageId === message2.id,
    'source_team_message_id_mismatch',
  );
  assertion(
    JSON.stringify(boundTask.inputTeamMessageIds) ===
      JSON.stringify([message2.id]),
    'input_team_message_ids_mismatch',
  );
  const productSourceBefore = boundTask.sourceMessageId ?? null;
  await composition.tasks.save(
    rehydrateTask({
      ...boundTask,
      sourceTeamMessageId: randomUUID(),
      inputTeamMessageIds: [randomUUID()],
    }),
  );
  const afterForgery = await composition.tasks.findById(boundTask.id);
  assertion(afterForgery, 'attempt2_task_missing_after_upsert');
  assertion(
    afterForgery.sourceTeamMessageId === message2.id,
    'source_team_message_id_overwritten',
  );
  assertion(
    JSON.stringify(afterForgery.inputTeamMessageIds) ===
      JSON.stringify([message2.id]),
    'input_team_message_ids_overwritten',
  );
  assertion(
    (afterForgery.sourceMessageId ?? null) === productSourceBefore,
    'product_session_source_message_changed',
  );
  const countsAfterForgery = await exactCounts(pool, message2.id);
  assertion(
    JSON.stringify(countsBeforeForgery) === JSON.stringify(countsAfterForgery),
    'cardinality_changed_after_replay_or_upsert',
  );
  assertion(
    Object.values(countsAfterForgery).every((count) => count === 1),
    'scenario_d_cardinality_not_one',
  );
  const relation = await pool.query(
    "SELECT to_regclass('public.team_turn_requests')::text AS relation",
  );
  assertion(relation.rows[0]?.relation === null, 'team_turn_requests_exists');
  const message2After = await messageForAttempt(pool, attempt2.id);
  assertion(
    message2After.body_hash === message2.body_hash,
    'team_message_body_changed',
  );
  marker('SCENARIO_D_EXACTLY_ONCE_AND_IMMUTABLE', {
    pre: {
      counts: countsBeforeForgery,
      body_hash: message2.body_hash,
      product_session_source_message_id: productSourceBefore,
    },
    expected: {
      counts: { messages: 1, tasks: 1, runs: 1, dispatches: 1 },
      source_team_message_id: message2.id,
      input_team_message_ids: [message2.id],
      body_hash_unchanged: true,
      team_turn_requests: null,
      product_session_source_unchanged: true,
    },
    actual: {
      counts: countsAfterForgery,
      source_team_message_id: afterForgery.sourceTeamMessageId,
      input_team_message_ids: afterForgery.inputTeamMessageIds,
      body_hash_unchanged: message2After.body_hash === message2.body_hash,
      team_turn_requests: relation.rows[0]?.relation,
      product_session_source_unchanged:
        (afterForgery.sourceMessageId ?? null) === productSourceBefore,
      attempt_status: attempt2After.status,
      task_status: attempt2Terminal.task_status,
      run_status: attempt2Terminal.run_status,
      member_status: memberAfter.status,
      dispatch_published: attempt2Terminal.published_at !== null,
    },
  });
  marker('RESULT_PASS', {
    pre: { scenario: 'C_and_D_same_team_and_member' },
    expected: 'production_message_wake_terminal_and_exactly_once',
    actual: {
      same_team_run_id: team.id,
      same_member_id: member.id,
      attempt1_status: attempt1After.status,
      attempt2_status: attempt2After.status,
      attempt2_task_status: attempt2Terminal.task_status,
      attempt2_run_status: attempt2Terminal.run_status,
      migration_gate: '0024_agent_team_messages',
      provider_used: false,
      paseo_used: false,
      outer_timeout_seconds: outerTimeoutSeconds,
      expected_exit_code: 0,
      elapsed_ms: Date.now() - startedAtMs,
    },
  });
} catch (error) {
  marker('RESULT_BLOCKED', {
    pre: { scenario: 'C_and_D_same_team_and_member' },
    expected: 'production_message_wake_terminal_and_exactly_once',
    actual: {
      error: error instanceof Error ? error.message : 'unknown_error',
      dispatcher_logs: dispatcherLogs.slice(-8),
    },
    classification: 'fixture_or_product_contract',
  });
  errorLine(error);
  process.exitCode = 1;
} finally {
  await composition?.dispatcher?.stop?.().catch(() => undefined);
  await composition?.mcp?.stop?.().catch(() => undefined);
  await pool?.end?.().catch(() => undefined);
  await admin?.end?.().catch(() => undefined);
  await writeEvidence();
}
