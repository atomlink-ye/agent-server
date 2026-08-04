import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { register as registerTsx } from 'tsx/esm/api';
registerTsx();
import { Client } from 'pg';
import {
  getAvailablePort,
  startPaseo,
  stopProcessTree,
} from '../dev/paseo-process.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const fixtureName =
  process.env.AGENTIC_TEAM_STEP_FIXTURE ?? 'agentic-team-step';
if (!/^[a-z0-9-]+$/u.test(fixtureName)) {
  throw new Error('invalid_AGENTIC_TEAM_STEP_FIXTURE');
}
const evidenceRoot = join(root, '.local', fixtureName);
const manifestPath = join(evidenceRoot, 'manifest.json');
const inspectEnvPath = join(evidenceRoot, 'inspect.env');
const command = process.argv[2];
const selectedRunId = process.argv[3];
const allowedCommands = new Set(['init', 'prove', 'status', 'next', 'step']);
if (!allowedCommands.has(command) || (command === 'step' && !selectedRunId)) {
  throw new Error(
    'usage: node scripts/debug/agentic-team-single-run.mjs init|prove|status|next|step <run-id>',
  );
}

await mkdir(evidenceRoot, { recursive: true });
if (command === 'init' || command === 'prove') await initialize();
else await useFixture();

async function initialize() {
  try {
    await readFile(manifestPath, 'utf8');
    throw new Error(
      `fixture_already_exists: reuse ${inspectEnvPath}; no automatic cleanup`,
    );
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const adminUrl = process.env.POSTGRES_ADMIN_URL;
  if (!adminUrl) throw new Error('missing_POSTGRES_ADMIN_URL');
  requireAuthorizedCredentialSource();
  configureProvider();
  const fixtureId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const dbName = `agent_server_team_step_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const runtimeRoot = join(evidenceRoot, 'runtime');
  const projectCwd = join(runtimeRoot, 'project');
  const cellRoot = join(runtimeRoot, 'cells');
  const token = `team-step-${randomUUID()}`;
  const tenantId = 'tenant_agentic_team_step';
  const principalId = 'svc_agentic_team_step';
  const workspaceId = randomUUID();
  await mkdir(projectCwd, { recursive: true });
  const admin = new Client({ connectionString: adminUrl });
  let paseo;
  let service;
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${dbName.replaceAll('"', '""')}"`);
    const dbUrl = new URL(adminUrl);
    dbUrl.pathname = `/${dbName}`;
    paseo = await startFixturePaseo(runtimeRoot);
    configureService({
      dbUrl: dbUrl.toString(),
      paseo,
      projectCwd,
      cellRoot,
      runtimeRoot,
      token,
      tenantId,
      principalId,
      workspaceId,
    });
    service = await createDebugService();
    await service.runtime.initialize();
    const request = createRequest(service.app, token);
    const db = new Client({ connectionString: dbUrl.toString() });
    await db.connect();
    try {
      await db.query(
        'INSERT INTO workspaces(id,tenant_id,principal_type,principal_id,name,created_at,updated_at) VALUES($1,$2,$3,$4,$5,now(),now())',
        [
          workspaceId,
          tenantId,
          'service_account',
          principalId,
          'Agentic Team Single Run',
        ],
      );
      const agents = [];
      for (const name of ['lead', 'analyst', 'verifier']) {
        const imported = await request(
          '/api/v1/agents:import',
          'POST',
          { source: agentYaml(name) },
          201,
        );
        await request(
          `/api/v1/agent-versions/${imported.version.id}:publish`,
          'POST',
          {},
          200,
        );
        agents.push({ name, versionId: imported.version.id });
      }
      const environment = await request(
        '/api/v1/environments:import',
        'POST',
        { source: environmentYaml() },
        201,
      );
      await request(
        `/api/v1/environment-versions/${environment.version.id}:publish`,
        'POST',
        {},
        200,
      );
      const byName = (name) =>
        agents.find((agent) => agent.name === name).versionId;
      const importedTeam = await request(
        '/api/v1/teams:import',
        'POST',
        {
          source: teamYaml(
            byName('lead'),
            byName('analyst'),
            byName('verifier'),
            environment.version.id,
          ),
        },
        201,
      );
      const publishedTeam = await request(
        `/api/v1/team-versions/${importedTeam.version.id}:publish`,
        'POST',
        {},
        200,
      );
      const invoked = await request(
        '/api/v1/tasks:invoke',
        'POST',
        {
          invokable: { kind: 'team', version_id: publishedTeam.id },
          input: {
            text: 'Lead: create one research task for each member, review both, and finish.',
          },
        },
        202,
      );
      const manifest = {
        fixture_id: fixtureId,
        root_task_id: invoked.task_id,
        db_name: dbName,
        runtime_root: runtimeRoot,
        project_cwd: projectCwd,
        cell_root: cellRoot,
        workspace_id: workspaceId,
        tenant_id: tenantId,
        principal_id: principalId,
        model: 'opencode-go/deepseek-v4-flash',
        created_at: new Date().toISOString(),
      };
      await atomicJson(manifestPath, manifest, 0o600);
      await atomicWrite(
        inspectEnvPath,
        `DATABASE_URL=${shellQuote(dbUrl.toString())}\nPOSTGRES_URL=${shellQuote(dbUrl.toString())}\nROOT_TASK_ID=${invoked.task_id}\nRUNTIME_ROOT=${shellQuote(runtimeRoot)}\n`,
        0o600,
      );
      const snapshot = await normalizedSnapshot(db, invoked.task_id);
      await captureEvidence('00-init', snapshot, null);
      printSummary(snapshot);
      if (command === 'prove') {
        await proveFixture({
          db,
          rootTaskId: invoked.task_id,
          service,
          paseo,
        });
      }
    } finally {
      await db.end();
    }
  } finally {
    await service?.close?.().catch(() => undefined);
    await (
      paseo?.child ? stopProcessTree(paseo.child) : Promise.resolve()
    ).catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
}

async function proveFixture(input) {
  const steps = [];
  for (;;) {
    const before = await normalizedSnapshot(input.db, input.rootTaskId);
    const next = uniqueNext(before);
    assertBeforeStep(before, next);
    const result = await input.service.singleRunDebug.claimAndExecute(
      next.run_id,
    );
    if (!result.claimed) throw new Error('exact_run_claim_failed');
    const after = await normalizedSnapshot(input.db, input.rootTaskId);
    assertAfterStep(
      before,
      after,
      next.run_id,
      next.label !== 'analyst-attempt-2',
    );
    const row = after.tasks_runs.find((entry) => entry.run_id === next.run_id);
    const paseoLogs = row?.provider_agent_id
      ? await capturePaseoLogs(
          row.provider_agent_id,
          input.paseo.healthUrl.replace('/api/health', ''),
        )
      : {
          command: null,
          redacted_lines: [],
          note: 'provider_agent_id_not_materialized',
        };
    await captureEvidence(nextEvidenceName(`prove-${next.label}`), after, {
      selected_run_id: next.run_id,
      label: next.label,
      terminal_status: result.terminalStatus ?? null,
      paseo_logs: paseoLogs,
    });
    steps.push({
      label: next.label,
      run_id: next.run_id,
      terminal_status: result.terminalStatus ?? null,
      provider_agent_id: row?.provider_agent_id ?? null,
    });
    if (next.label === 'analyst-attempt-2') break;
  }
  const final = await normalizedSnapshot(input.db, input.rootTaskId);
  const attempt2 = final.attempts.find((attempt) => attempt.attempt_no === 2);
  if (!attempt2 || attempt2.status !== 'completed')
    throw new Error('attempt2_terminal_missing');
  console.log(
    JSON.stringify(
      {
        proved: steps,
        final: { team_run: final.team_run, attempts: final.attempts },
      },
      null,
      2,
    ),
  );
}

async function useFixture() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const env = parseInspectEnv(await readFile(inspectEnvPath, 'utf8'));
  const db = new Client({ connectionString: env.DATABASE_URL });
  await db.connect();
  try {
    const before = await normalizedSnapshot(db, manifest.root_task_id);
    if (command === 'status') {
      let provider_logs = [];
      let paseo;
      try {
        if (process.env.AGENTIC_TEAM_CAPTURE_LOGS === '1') {
          requireAuthorizedCredentialSource();
          configureProvider();
          paseo = await startFixturePaseo(manifest.runtime_root);
          const host = paseo.healthUrl.replace('/api/health', '');
          for (const providerAgentId of new Set(
            before.tasks_runs
              .map((row) => row.provider_agent_id)
              .filter(Boolean),
          )) {
            provider_logs.push({
              provider_agent_id: providerAgentId,
              ...(await capturePaseoLogs(providerAgentId, host)),
            });
          }
        }
        await captureEvidence(
          nextEvidenceName('status'),
          before,
          provider_logs.length ? { provider_logs } : null,
        );
      } finally {
        await (
          paseo?.child ? stopProcessTree(paseo.child) : Promise.resolve()
        ).catch(() => undefined);
      }
      printSummary(before);
      return;
    }
    const next = uniqueNext(before);
    if (command === 'next') {
      console.log(JSON.stringify(next, null, 2));
      return;
    }
    if (selectedRunId !== next.run_id)
      throw new Error(
        `selected_run_is_not_unique_next: expected ${next.run_id}`,
      );
    assertBeforeStep(before, next);
    requireAuthorizedCredentialSource();
    configureProvider();
    let paseo;
    let service;
    const startedAt = Date.now();
    try {
      paseo = await startFixturePaseo(manifest.runtime_root);
      configureService({
        dbUrl: env.DATABASE_URL,
        paseo,
        projectCwd: manifest.project_cwd,
        cellRoot: manifest.cell_root,
        runtimeRoot: manifest.runtime_root,
        token: 'debug-not-used',
        tenantId: manifest.tenant_id,
        principalId: manifest.principal_id,
        workspaceId: manifest.workspace_id,
      });
      service = await createDebugService();
      await service.runtime.initialize();
      const result =
        await service.singleRunDebug.claimAndExecute(selectedRunId);
      if (!result.claimed) throw new Error('exact_run_claim_failed');
      const after = await normalizedSnapshot(db, manifest.root_task_id);
      assertAfterStep(before, after, selectedRunId);
      const row = after.tasks_runs.find(
        (entry) => entry.run_id === selectedRunId,
      );
      const logs = row?.provider_agent_id
        ? await capturePaseoLogs(
            row.provider_agent_id,
            paseo.healthUrl.replace('/api/health', ''),
          )
        : {
            command: null,
            redacted_lines: [],
            note: 'provider_agent_id_not_materialized',
          };
      const elapsedMs = Date.now() - startedAt;
      const evidenceName = nextEvidenceName(`step-${next.label}`);
      await captureEvidence(evidenceName, after, {
        selected_run_id: selectedRunId,
        label: next.label,
        terminal_status: result.terminalStatus ?? null,
        elapsed_ms: elapsedMs,
        paseo_logs: logs,
      });
      console.log(
        JSON.stringify(
          {
            transition: next.label,
            run_id: selectedRunId,
            terminal_status: result.terminalStatus,
            elapsed_ms: elapsedMs,
            evidence: join(evidenceRoot, `${evidenceName}.json`),
          },
          null,
          2,
        ),
      );
    } finally {
      await service?.close?.().catch(() => undefined);
      await (
        paseo?.child ? stopProcessTree(paseo.child) : Promise.resolve()
      ).catch(() => undefined);
    }
  } finally {
    await db.end();
  }
}

async function createDebugService() {
  const { loadConfig } = await import('../../src/shared/config.ts');
  const { createLogger } =
    await import('../../src/shared/observability/logger.ts');
  const { createService } = await import('../../src/bootstrap.ts');
  const config = loadConfig();
  return createService(
    config,
    createLogger({
      service: config.serviceName,
      minimumLevel: config.logLevel,
      write: () => undefined,
    }),
    { singleRunDebug: true },
  );
}

async function startFixturePaseo(runtimeRoot) {
  return startPaseo({
    repositoryRoot: root,
    runtimeRoot,
    port: await getAvailablePort(),
    environmentVariableNames: [
      'OPENCODE_GO_API_KEY',
      'OPENCODE_CONFIG_CONTENT',
    ],
  });
}

function configureService(input) {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = input.dbUrl;
  process.env.POSTGRES_URL = input.dbUrl;
  process.env.PASEO_WS_URL = input.paseo.wsUrl;
  process.env.PASEO_AGENT_CWD = input.projectCwd;
  process.env.PASEO_RUNTIME_CELL_ROOT = input.cellRoot;
  process.env.AGENT_SERVER_SKILL_REGISTRY_ROOT = join(
    input.runtimeRoot,
    'skills',
  );
  process.env.PASEO_MODEL = 'opencode-go/deepseek-v4-flash';
  process.env.PASEO_EXECUTION_TIMEOUT_MS ??= '600000';
  process.env.SERVICE_ACCOUNTS_JSON = JSON.stringify([
    {
      serviceAccountId: input.principalId,
      token: input.token,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      policyVersion: 'agentic-team-step-v1',
    },
  ]);
}

function configureProvider() {
  process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    agent: { build: { permission: 'allow' } },
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
}

function createRequest(app, token) {
  return async (path, method, body, expected) => {
    const response = await app.request(`http://debug.local${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status !== expected)
      throw new Error(`http_${response.status}_expected_${expected}`);
    return response.json();
  };
}

async function normalizedSnapshot(db, rootTaskId) {
  const team =
    (
      await db.query(
        `SELECT id,status,execution_mode,control_state,revision,lead_turn_count,phase FROM team_runs WHERE root_task_id=$1 ORDER BY created_at DESC LIMIT 1`,
        [rootTaskId],
      )
    ).rows[0] ?? null;
  const rows = (
    await db.query(
      `SELECT t.id AS task_id,t.team_task_kind AS kind,t.logical_step_key,t.status AS task_status,t.created_at,
      r.id AS run_id,r.attempt,r.status AS run_status,r.lease_owner,r.activation_id,r.lease_expires_at,r.error->>'code' AS error_code,
      rs.id AS runtime_session_id,rs.provider_agent_id,mr.name AS member_name,
      (SELECT min(rd.id) FROM run_dispatches rd WHERE rd.run_id=r.id AND rd.event_type='run.enqueue' AND rd.published_at IS NULL) AS dispatch_id
    FROM tasks t LEFT JOIN runs r ON r.task_id=t.id LEFT JOIN runtime_sessions rs ON rs.task_id=t.id
    LEFT JOIN team_member_runs mr ON mr.id=t.team_member_run_id
    WHERE t.root_task_id=$1 ORDER BY t.created_at,r.attempt`,
      [rootTaskId],
    )
  ).rows;
  const attempts = team
    ? (
        await db.query(
          `SELECT attempt_no,status,execution_task_id,(result_summary IS NOT NULL) AS has_result FROM team_work_item_attempts WHERE team_run_id=$1 ORDER BY created_at`,
          [team.id],
        )
      ).rows
    : [];
  const receipts = (
    await db.query(
      `SELECT tr.command_name,tr.source_run_id,tr.created_at FROM team_command_receipts tr JOIN runs r ON r.id=tr.source_run_id JOIN tasks t ON t.id=r.task_id WHERE t.root_task_id=$1 ORDER BY tr.created_at`,
      [rootTaskId],
    )
  ).rows;
  return sanitize({
    captured_at: new Date().toISOString(),
    root_task_id: rootTaskId,
    team_run: team
      ? {
          status: team.status,
          execution_mode: team.execution_mode,
          control_state: team.control_state,
          revision: Number(team.revision),
          lead_turn_count: Number(team.lead_turn_count),
          phase: team.phase,
        }
      : null,
    tasks_runs: rows.map((row) => ({
      task_id: row.task_id,
      is_root: row.task_id === rootTaskId,
      kind: row.kind,
      member_name: row.member_name,
      logical_step_key: row.logical_step_key,
      task_status: row.task_status,
      run_id: row.run_id,
      dispatch_id: row.dispatch_id === null ? null : Number(row.dispatch_id),
      attempt: row.attempt === null ? null : Number(row.attempt),
      run_status: row.run_status,
      claimed: Boolean(row.lease_owner || row.activation_id),
      lease_expired: row.lease_expires_at
        ? Date.parse(row.lease_expires_at) < Date.now()
        : false,
      error_code: row.error_code,
      runtime_session_id: row.runtime_session_id,
      provider_agent_id: row.provider_agent_id,
    })),
    attempts: attempts.map((row) => ({
      attempt_no: Number(row.attempt_no),
      status: row.status,
      execution_task_id: row.execution_task_id,
      has_result: row.has_result,
    })),
    receipts: receipts.map((row) => ({
      command_name: row.command_name,
      source_run_id: row.source_run_id,
      created_at: row.created_at,
    })),
  });
}

function uniqueNext(snapshot) {
  const queued = snapshot.tasks_runs
    .filter((row) => row.run_status === 'queued' && row.dispatch_id !== null)
    .sort((left, right) => left.dispatch_id - right.dispatch_id);
  if (!queued.length) throw new Error('next_run_missing');
  if (queued.length > 1 && queued[0].dispatch_id === queued[1].dispatch_id)
    throw new Error(`next_dispatch_not_unique:${queued[0].dispatch_id}`);
  const row = queued[0];
  return {
    run_id: row.run_id,
    task_id: row.task_id,
    label: transitionLabel(snapshot, row),
  };
}

function transitionLabel(snapshot, row) {
  if (row.is_root) return 'root-activation';
  if (row.kind === 'lead_turn')
    return snapshot.team_run?.lead_turn_count > 1 ? 'lead-review' : 'lead-1';
  const member = row.member_name ?? 'member';
  const attempt =
    snapshot.attempts.find((entry) => entry.execution_task_id === row.task_id)
      ?.attempt_no ?? row.attempt;
  return `${member}-attempt-${attempt ?? 'unknown'}`;
}

function assertBeforeStep(snapshot, next) {
  if (snapshot.tasks_runs.some((row) => row.claimed))
    throw new Error('invariant_active_claim_exists');
  if (snapshot.tasks_runs.some((row) => row.lease_expired))
    throw new Error('invariant_expired_lease_exists');
  const allowed = [
    'root-activation',
    'lead-1',
    'analyst-attempt-1',
    'verifier-attempt-1',
    'lead-review',
    'analyst-attempt-2',
  ];
  if (!allowed.includes(next.label))
    throw new Error(`unexpected_transition:${next.label}`);
}

function assertAfterStep(before, after, runId, requireNext = true) {
  const row = after.tasks_runs.find((entry) => entry.run_id === runId);
  if (
    !row ||
    ![
      'succeeded',
      'failed',
      'timed_out',
      'cancelled',
      'waiting_children',
    ].includes(row.run_status)
  )
    throw new Error(
      `selected_run_not_terminal:${row?.run_status ?? 'missing'}`,
    );
  if (row.claimed) throw new Error('selected_run_claim_not_released');
  if (
    after.tasks_runs.some(
      (entry) =>
        entry.run_id !== runId &&
        before.tasks_runs.find((prior) => prior.run_id === entry.run_id)
          ?.run_status === 'queued' &&
        entry.run_status !== 'queued',
    )
  )
    throw new Error('non_selected_queued_run_advanced');
  if (requireNext) uniqueNext(after);
}

async function capturePaseoLogs(providerAgentId, host) {
  const args = [
    'exec',
    'paseo',
    'logs',
    providerAgentId,
    '--host',
    host,
    '--tail',
    '200',
  ];
  const output = await spawnCapture('pnpm', args);
  return {
    command: `pnpm exec paseo logs ${providerAgentId} --host ${host} --tail 200`,
    exit_code: output.code,
    redacted_lines: output.stdout
      .split('\n')
      .filter(Boolean)
      .map(redactLogLine),
    stderr_redacted: redactText(output.stderr),
  };
}

function spawnCapture(executable, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, {
      cwd: root,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => resolvePromise({ code, stdout, stderr }));
  });
}

function redactLogLine(line) {
  try {
    return sanitize(JSON.parse(line));
  } catch {
    return redactText(line);
  }
}
function redactText(value) {
  return String(value).replace(
    /(prompt|content|message|result|output|authorization|token|secret|password)([=:]\s*)[^,\s]+/giu,
    '$1$2[redacted]',
  );
}
function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) =>
        /prompt|content|message|result|output|authorization|token|secret|password|api.?key/i.test(
          key,
        )
          ? [key, '[redacted]']
          : [key, sanitize(entry)],
      ),
    );
  return typeof value === 'string' ? redactText(value) : value;
}

async function captureEvidence(name, snapshot, transition) {
  await atomicJson(
    join(evidenceRoot, `${name}.json`),
    sanitize({ snapshot, transition }),
    0o600,
  );
}
function nextEvidenceName(label) {
  return `${String(Date.now())}-${label.replace(/[^a-z0-9-]/gi, '-')}`;
}
function printSummary(snapshot) {
  let next;
  try {
    next = uniqueNext(snapshot);
  } catch (error) {
    next = { blocker: error.message };
  }
  console.log(JSON.stringify({ snapshot, next }, null, 2));
}
async function atomicJson(path, value, mode) {
  await atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`, mode);
}
async function atomicWrite(path, value, mode) {
  const temp = `${path}.tmp-${process.pid}`;
  await writeFile(temp, value, { mode });
  await rename(temp, path);
  await chmod(path, mode);
}
function parseInspectEnv(text) {
  return Object.fromEntries(
    text
      .trim()
      .split('\n')
      .map((line) => {
        const index = line.indexOf('=');
        let value = line.slice(index + 1);
        if (value.startsWith("'") && value.endsWith("'"))
          value = value.slice(1, -1).replaceAll("'\\''", "'");
        return [line.slice(0, index), value];
      }),
  );
}
function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
function requireAuthorizedCredentialSource() {
  if (!process.env.OPENCODE_GO_API_KEY)
    throw new Error(
      'missing_OPENCODE_GO_API_KEY: source /Volumes/AgentsWorkspace/orgs/0xdtech/.local/.env',
    );
}

function agentYaml(name) {
  const displayName =
    name === 'lead' ? 'Lead' : name === 'analyst' ? 'Analyst' : 'Verifier';
  const tools =
    name === 'lead'
      ? '    - ref: agent-server/team-state\n      kind: tool\n    - ref: agent-server/team-work-list\n      kind: tool\n    - ref: agent-server/team-work-create\n      kind: tool\n    - ref: agent-server/team-work-request-changes\n      kind: tool\n    - ref: agent-server/team-work-accept-v2\n      kind: tool\n    - ref: agent-server/team-finish\n      kind: tool'
      : '    - ref: agent-server/team-state\n      kind: tool\n    - ref: agent-server/team-work-list\n      kind: tool\n    - ref: agent-server/team-work-checkpoint\n      kind: tool\n    - ref: agent-server/team-work-submit\n      kind: tool';
  const instructions =
    name === 'lead'
      ? 'Act directly as Lead. Turn 1 create exactly one Work for analyst and one for verifier. On review request changes exactly once for analyst Attempt 1 lacking event evidence and accept verifier. Next review accept corrected analyst and finish. Use only canonical Team tools and never repeat a successful mutation.'
      : name === 'analyst'
        ? 'Use canonical member tools. Attempt 1 obtain stock snapshot only, checkpoint once, submit once. Attempt 2 obtain stock snapshot and event batch, checkpoint once, submit once. Include ACME, data_as_of 2026-07-31, uncertainty, risk, and no investment advice.'
        : 'Use canonical member tools. Obtain stock snapshot and event batch, checkpoint once, submit once. Include ACME, data_as_of 2026-07-31, uncertainty, risk, and no investment advice.';
  return `apiVersion: agent-server/v1alpha1\nkind: ManagedAgent\nmetadata:\n  name: team-step-${name}\nspec:\n  description: Agentic Team step debugger ${displayName}\n  instructions: ${JSON.stringify(instructions)}\n  runtime:\n    provider: paseo\n    modelPolicyRef: free-only\n    mode: isolated\n  tools:\n${tools}\n    - ref: agent-server/synthetic-stock-snapshot\n      kind: tool\n    - ref: agent-server/synthetic-event-batch\n      kind: tool\n  skills: []\n  input:\n    schema:\n      type: object\n      properties: {}\n      additionalProperties: false\n    prompt: "Execute your assigned role."\n  session:\n    invocation: fresh_per_invocation\n    followUps: queued\n    binding: reusable\n  memory:\n    policy: workspace_snapshot\n    proposalLimit: 0\n  permissions:\n    network: read_only\n    filesystem: workspace_read\n  completion:\n    type: executable\n    command: "done"\n`;
}
function environmentYaml() {
  return 'apiVersion: agent-server/v1alpha1\nkind: ManagedEnvironment\nmetadata:\n  name: agentic-team-step\nspec:\n  adapter: paseo\n  provider: opencode\n  modelPolicyRef: free-only\n  runtimeCellPolicy: per_runtime_session\n';
}
function teamYaml(lead, analyst, verifier, environment) {
  return `apiVersion: agent-server/v1alpha1\nkind: ManagedTeam\nmetadata:\n  name: agentic-team-step\nspec:\n  environmentVersionId: ${environment}\n  lead:\n    name: lead\n    agentVersionId: ${lead}\n  roster:\n    - name: analyst\n      agentVersionId: ${analyst}\n    - name: verifier\n      agentVersionId: ${verifier}\n  coordination:\n    mode: agentic_mve\n    taskAssignment: lead_or_self_claim\n`;
}
