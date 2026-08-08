// Re-runnable real mixed-provider ManagedTeam smoke; it uses live provider runs.
// It intentionally does not use scripted execution or synthetic activity.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { Client as PostgresClient } from 'pg';
import {
  mixedTeamAgentYaml,
  mixedTeamEnvironmentYaml,
  mixedTeamYaml,
} from '../dev/web-bootstrap-fixtures.mjs';

const baseUrl = process.env.AGENT_SERVER_BASE_URL ?? 'http://127.0.0.1:3000';
const token = process.env.AGENT_SERVER_SERVICE_TOKEN ?? 'token-local-dev';
const workspaceId = process.env.AGENT_SERVER_WORKSPACE_ID ?? 'workspace_main';
const timeoutMs = Number(process.env.MIXED_TEAM_TIMEOUT_MS ?? 900_000);
const startedAt = Date.now();
const databaseUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
const packageMarker = JSON.parse(await readFile('package.json', 'utf8'));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
assert(
  packageMarker.name === '@atomlink-ye/agent-server',
  'agent_server_working_directory_required',
);
await readFile('compose.yaml', 'utf8');
assert(databaseUrl, 'DATABASE_URL_or_POSTGRES_URL_required');

async function request(path, { method = 'GET', body, status } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (status !== undefined && response.status !== status)
    throw new Error(`${method} ${path} -> ${response.status} ${text}`);
  if (status === undefined && !response.ok)
    throw new Error(`${method} ${path} -> ${response.status} ${text}`);
  return text ? JSON.parse(text) : {};
}
async function importAndPublish(source, importPath, publishPath) {
  const imported = await request(importPath, {
    method: 'POST',
    body: { source },
    status: 201,
  });
  await request(publishPath(imported.version.id), { method: 'POST', body: {} });
  return imported.version.id;
}
const existingRootTaskId = process.env.MIXED_TEAM_EXISTING_ROOT_TASK_ID?.trim();
let rootTaskId;
if (existingRootTaskId) {
  rootTaskId = existingRootTaskId;
} else {
  const agents = {};
  for (const name of ['lead', 'fixer', 'reviewer'])
    agents[name] = await importAndPublish(
      mixedTeamAgentYaml(name),
      '/api/v1/agents:import',
      (id) => `/api/v1/agent-versions/${id}:publish`,
    );
  const environment = await importAndPublish(
    mixedTeamEnvironmentYaml(),
    '/api/v1/environments:import',
    (id) => `/api/v1/environment-versions/${id}:publish`,
  );
  const team = await request('/api/v1/teams:import', {
    method: 'POST',
    body: {
      source: mixedTeamYaml(
        agents.lead,
        agents.fixer,
        agents.reviewer,
        environment,
      ),
    },
    status: 201,
  });
  const publishedTeam = await request(
    `/api/v1/team-versions/${team.version.id}:publish`,
    { method: 'POST', body: {} },
  );
  const invoked = await request('/api/v1/tasks:invoke', {
    method: 'POST',
    status: 202,
    body: {
      invokable: { kind: 'team', version_id: publishedTeam.id },
      input: {
        text: 'Produce one mixed-provider TeamRun proof for mixed_team_rework.py.',
      },
      workspace_id: workspaceId,
    },
  });
  rootTaskId = invoked.task_id;
  await writeFile(
    '.local/web-bootstrap.env',
    [
      `WEB_WORKSPACE_ID=${workspaceId}`,
      'WEB_WORKSPACE_NAME=Mixed-provider TeamRun proof',
      `WEB_AGENTIC_TEAM_VERSION_ID=${publishedTeam.id}`,
      `WEB_ENVIRONMENT_VERSION_ID=${environment}`,
      `WEB_AGENT_VERSION_ID=${agents.fixer}`,
      '',
    ].join('\n'),
  );
}

let projection;
let terminalTask;
while (Date.now() - startedAt < timeoutMs) {
  terminalTask = await request(`/api/v1/tasks/${rootTaskId}`);
  projection = await request(
    `/api/v1/team-runs:project?root_task_id=${encodeURIComponent(rootTaskId)}`,
  );
  if (['completed', 'failed', 'cancelled'].includes(terminalTask.status)) break;
  await new Promise((resolve) => setTimeout(resolve, 2_000));
}
assert(terminalTask?.status === 'completed', 'root_task_not_terminal_success');
assert(projection?.project?.status === 'succeeded', 'team_run_not_succeeded');
const evidenceRoot = `.local/mixed-team-evidence/${rootTaskId}`;
await mkdir(evidenceRoot, { recursive: true });
const db = new PostgresClient({ connectionString: databaseUrl });
await db.connect();
const query = async (text, values = []) => (await db.query(text, values)).rows;
const providers = await query(
  `SELECT m.name AS member_name, m.role, av.policy_snapshot->>'modelPolicyRef' AS model_policy_ref, r.runtime->>'provider' AS provider, r.runtime->>'model' AS model, count(*)::int AS run_count FROM team_runs tr JOIN team_member_runs m ON m.team_run_id=tr.id JOIN agent_versions av ON av.id=m.agent_version_id JOIN tasks t ON t.team_member_run_id=m.id AND t.root_task_id=tr.root_task_id JOIN runs r ON r.task_id=t.id WHERE tr.root_task_id=$1 AND r.status='succeeded' GROUP BY m.name,m.role,av.policy_snapshot,r.runtime->>'provider',r.runtime->>'model' ORDER BY m.name`,
  [rootTaskId],
);
const expectedProviders = {
  lead: {
    policy: 'free-only',
    provider: 'opencode',
    model: 'opencode-go/deepseek-v4-flash',
  },
  fixer: {
    policy: 'claude/deepseek-v4-flash',
    provider: 'claude',
    model: 'deepseek-v4-flash',
  },
  reviewer: {
    policy: 'codex/deepseek-v4-flash',
    provider: 'codex',
    model: 'deepseek-v4-flash',
  },
};
assert(providers.length === 3, 'provider_mapping_cardinality_invalid');
for (const row of providers) {
  const expected = expectedProviders[row.member_name];
  assert(expected, `unexpected_provider_member_${row.member_name}`);
  assert(row.run_count > 0, `provider_run_count_invalid_${row.member_name}`);
  assert(
    row.model_policy_ref === expected.policy,
    `provider_policy_mismatch_${row.member_name}`,
  );
  assert(
    row.provider === expected.provider,
    `provider_mismatch_${row.member_name}`,
  );
  assert(row.model === expected.model, `model_mismatch_${row.member_name}`);
}
const scriptedRuntimeDetected = providers.some((row) =>
  /scripted/i.test(`${row.provider} ${row.model}`),
);
assert(!scriptedRuntimeDetected, 'scripted_model_detected');
await writeFile(
  `${evidenceRoot}/providers.json`,
  JSON.stringify(providers, null, 2),
);
const teamRunId = (
  await query('SELECT id FROM team_runs WHERE root_task_id=$1', [rootTaskId])
)[0]?.id;
assert(teamRunId, 'team_run_missing');
const workRows = await query(
  `SELECT w.id AS work_ref,w.subject,w.status AS work_status,w.created_at,w.updated_at,m.name AS assignee_name,m.role AS assignee_role,c.name AS created_by_name,c.role AS created_by_role FROM team_work_items w JOIN team_member_runs m ON m.id=w.owner_member_id JOIN team_member_runs c ON c.id=w.created_by_member_id WHERE w.team_run_id=$1 ORDER BY w.created_at,w.id`,
  [teamRunId],
);
const createReceipts = await query(
  `SELECT c.source_run_id,c.created_at AS receipt_created_at,c.result_json,t.id AS task_id,m.name AS source_member_name,d.id AS dispatch_id FROM team_command_receipts c JOIN runs r ON r.id=c.source_run_id JOIN tasks t ON t.id=r.task_id JOIN team_member_runs m ON m.id=t.team_member_run_id LEFT JOIN run_dispatches d ON d.run_id=r.id AND d.event_type='run.enqueue' WHERE t.root_task_id=$1 AND c.command_name='team_work_create' ORDER BY c.created_at,c.command_hash`,
  [rootTaskId],
);
const dependencyRows = await query(
  'SELECT work_item_id,depends_on_work_item_id FROM team_work_item_dependencies WHERE team_run_id=$1',
  [teamRunId],
);
assert(
  workRows.length === 2 &&
    workRows.every((row) => row.work_status === 'accepted'),
  'exactly_two_accepted_work_items_required',
);
assert(
  workRows.every(
    (row) => row.created_by_name === 'lead' && row.created_by_role === 'lead',
  ),
  'work_creator_must_be_lead',
);
assert(
  createReceipts.length === 2 &&
    new Set(createReceipts.map((row) => row.source_run_id)).size === 1 &&
    createReceipts.every((row) => row.source_member_name === 'lead'),
  'exactly_two_kickoff_create_receipts_required',
);
assert(
  createReceipts.every((row) => row.task_id && row.dispatch_id),
  'kickoff_create_receipt_dispatch_missing',
);
assert(dependencyRows.length === 0, 'independent_work_dependency_rows_present');
const attemptRows = await query(
  `SELECT a.id AS attempt_ref,a.work_item_id AS work_ref,a.attempt_no,a.execution_task_id,a.status AS attempt_status,a.result_summary,a.feedback,a.created_at,a.updated_at,a.completed_at,m.name AS assignee_name,t.status AS task_status,r.id AS run_id,r.status AS run_status,d.id AS dispatch_id,d.created_at AS dispatch_created_at,min(e.created_at) FILTER (WHERE e.type='started') AS started_at,max(e.created_at) FILTER (WHERE e.type IN ('succeeded','failed','timed_out','cancelled')) AS terminal_at FROM team_work_item_attempts a JOIN team_member_runs m ON m.id=a.assignee_member_id JOIN tasks t ON t.id=a.execution_task_id JOIN runs r ON r.task_id=t.id LEFT JOIN run_dispatches d ON d.run_id=r.id AND d.event_type='run.enqueue' LEFT JOIN run_events e ON e.run_id=r.id WHERE a.team_run_id=$1 GROUP BY a.id,a.work_item_id,a.attempt_no,a.execution_task_id,a.status,a.result_summary,a.feedback,a.created_at,a.updated_at,a.completed_at,m.name,t.status,r.id,r.status,d.id,d.created_at ORDER BY d.id,a.attempt_no,a.id`,
  [teamRunId],
);
assert(
  attemptRows.every((row) => row.dispatch_id),
  'attempt_dispatch_binding_missing',
);
assert(
  createReceipts.every(
    (row) => row.result_json?.item_id && row.result_json?.attempt_id,
  ),
  'kickoff_create_receipt_binding_missing',
);
const kickoffAttempts = createReceipts.map((row) =>
  attemptRows.find(
    (attempt) => attempt.attempt_ref === row.result_json.attempt_id,
  ),
);
assert(
  kickoffAttempts.every(Boolean) &&
    new Set(kickoffAttempts.map((attempt) => attempt.attempt_ref)).size === 2,
  'kickoff_attempt_binding_invalid',
);
const kickoffOrder = [...kickoffAttempts].sort(
  (a, b) => Number(a.dispatch_id) - Number(b.dispatch_id),
);
assert(
  kickoffOrder[0].assignee_name === 'fixer' &&
    kickoffOrder[1].assignee_name === 'reviewer',
  'kickoff_work_order_invalid',
);
const reviewReason =
  'empty input is mishandled: the utility indexes the first token instead of returning an empty result.';
assert(attemptRows.length === 3, 'exactly_three_attempts_required');
const fixerV1 = attemptRows.find(
  (row) => row.assignee_name === 'fixer' && row.attempt_no === 1,
);
const reviewerV1 = attemptRows.find(
  (row) => row.assignee_name === 'reviewer' && row.attempt_no === 1,
);
const fixerV2 = attemptRows.find(
  (row) => row.assignee_name === 'fixer' && row.attempt_no === 2,
);
assert(
  fixerV1?.attempt_status === 'completed' &&
    fixerV1.result_summary?.includes('FIXER_SUBMIT_V1'),
  'fixer_v1_invalid',
);
assert(
  reviewerV1?.attempt_status === 'completed' &&
    reviewerV1.result_summary?.includes('REVIEW_REJECT') &&
    reviewerV1.result_summary?.includes(reviewReason),
  'reviewer_reject_invalid',
);
assert(
  fixerV2?.attempt_status === 'completed' &&
    fixerV2.result_summary?.includes('FIXER_SUBMIT_V2'),
  'fixer_v2_invalid',
);
assert(
  fixerV1 &&
    reviewerV1 &&
    fixerV2 &&
    Number(fixerV1.dispatch_id) < Number(reviewerV1.dispatch_id),
  'kickoff_dispatch_order_invalid',
);
const leadDispatchRows = await query(
  `SELECT t.id AS task_id,t.team_sequence,r.id AS run_id,r.status AS run_status,d.id AS dispatch_id,d.created_at AS dispatch_created_at,min(e.created_at) FILTER (WHERE e.type='started') AS started_at,max(e.created_at) FILTER (WHERE e.type IN ('succeeded','failed','timed_out','cancelled')) AS terminal_at FROM tasks t JOIN runs r ON r.task_id=t.id LEFT JOIN run_dispatches d ON d.run_id=r.id AND d.event_type='run.enqueue' LEFT JOIN run_events e ON e.run_id=r.id WHERE t.root_task_id=$1 AND t.team_task_kind='lead_turn' GROUP BY t.id,t.team_sequence,r.id,r.status,d.id,d.created_at ORDER BY d.id`,
  [rootTaskId],
);
assert(
  leadDispatchRows[0]?.run_id === createReceipts[0].source_run_id,
  'kickoff_receipts_not_earliest_lead_dispatch',
);
const requestChangesReceipt = await query(
  `SELECT c.source_run_id,c.created_at AS receipt_created_at,c.result_json,t.id AS task_id,d.id AS dispatch_id,d.created_at AS dispatch_created_at,min(e.created_at) FILTER (WHERE e.type='started') AS started_at,max(e.created_at) FILTER (WHERE e.type IN ('succeeded','failed','timed_out','cancelled')) AS terminal_at FROM team_command_receipts c JOIN runs r ON r.id=c.source_run_id JOIN tasks t ON t.id=r.task_id LEFT JOIN run_dispatches d ON d.run_id=r.id AND d.event_type='run.enqueue' LEFT JOIN run_events e ON e.run_id=r.id WHERE t.root_task_id=$1 AND c.command_name='team_work_request_changes' GROUP BY c.source_run_id,c.created_at,c.result_json,t.id,d.id,d.created_at ORDER BY c.created_at DESC LIMIT 1`,
  [rootTaskId],
);
const requestChanges = requestChangesReceipt[0];
assert(
  requestChanges?.dispatch_id &&
    Number(reviewerV1.dispatch_id) < Number(requestChanges.dispatch_id),
  'review_lead_dispatch_order_invalid',
);
assert(
  requestChanges.result_json?.attempt_id === fixerV2.attempt_ref,
  'request_changes_attempt_binding_invalid',
);
assert(
  new Date(reviewerV1.completed_at ?? reviewerV1.terminal_at) <=
    new Date(requestChanges.receipt_created_at),
  'reviewer_completion_after_request_changes',
);
assert(
  fixerV2.feedback?.includes(reviewReason),
  'fixer_v2_feedback_missing_exact_review_reason',
);
assert(
  fixerV2.started_at &&
    new Date(fixerV2.started_at) >= new Date(requestChanges.receipt_created_at),
  'fixer_v2_started_before_request_changes',
);
const reviewerWork = workRows.find((row) => row.assignee_name === 'reviewer');
const fixerWork = workRows.find((row) => row.assignee_name === 'fixer');
const acceptReceipts = await query(
  `SELECT c.created_at AS receipt_created_at,c.result_json FROM team_command_receipts c JOIN runs r ON r.id=c.source_run_id JOIN tasks t ON t.id=r.task_id WHERE t.root_task_id=$1 AND c.command_name='team_work_accept' ORDER BY c.created_at`,
  [rootTaskId],
);
const reviewerAccept = acceptReceipts.find(
  (row) => row.result_json?.work_item_id === reviewerWork?.work_ref,
);
const fixerAccept = acceptReceipts.find(
  (row) => row.result_json?.work_item_id === fixerWork?.work_ref,
);
assert(
  reviewerAccept &&
    new Date(reviewerAccept.receipt_created_at) >=
      new Date(reviewerV1.completed_at ?? reviewerV1.terminal_at),
  'reviewer_accept_before_completion',
);
assert(
  fixerAccept &&
    new Date(fixerAccept.receipt_created_at) >=
      new Date(fixerV2.completed_at ?? fixerV2.terminal_at),
  'fixer_v2_accept_before_completion',
);
const nonterminalChildren = await query(
  `SELECT t.id AS task_id,t.status AS task_status,r.status AS run_status FROM tasks t LEFT JOIN runs r ON r.task_id=t.id WHERE t.root_task_id=$1 AND t.id<>$1 AND (t.status NOT IN ('completed','failed','cancelled') OR (r.id IS NOT NULL AND r.status NOT IN ('succeeded','failed','timed_out','cancelled')))`,
  [rootTaskId],
);
assert(nonterminalChildren.length === 0, 'nonterminal_children_present');
const dispatchIntervals = [...attemptRows, ...leadDispatchRows]
  .filter((row) => row.started_at && row.terminal_at)
  .map((row) => ({
    dispatch_id: row.dispatch_id,
    started_at: row.started_at,
    terminal_at: row.terminal_at,
  }))
  .sort(
    (a, b) =>
      new Date(a.started_at) - new Date(b.started_at) ||
      Number(a.dispatch_id) - Number(b.dispatch_id),
  );
let effectiveConcurrency = 0;
let activeTerminals = [];
for (const interval of dispatchIntervals) {
  const startedAt = new Date(interval.started_at);
  activeTerminals = activeTerminals.filter(
    (terminalAt) => terminalAt > startedAt,
  );
  activeTerminals.push(new Date(interval.terminal_at));
  effectiveConcurrency = Math.max(effectiveConcurrency, activeTerminals.length);
}
assert(effectiveConcurrency >= 2, 'effective_dispatcher_concurrency_below_two');
const chronological = [
  ...workRows.map((row) => ({ kind: 'work', ...row })),
  ...attemptRows.map((row) => ({ kind: 'attempt', ...row })),
].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
const terminalTeam = await query(
  `SELECT status,phase,updated_at FROM team_runs WHERE root_task_id=$1`,
  [rootTaskId],
);
assert(
  terminalTeam.length === 1 && terminalTeam[0].status === 'succeeded',
  'durable_team_terminal_status_invalid',
);
const rootTerminalRows = await query(
  `SELECT t.id AS task_id,t.status AS task_status,r.id AS run_id,r.status AS run_status FROM tasks t JOIN runs r ON r.task_id=t.id WHERE t.id=$1 AND t.root_task_id=$1`,
  [rootTaskId],
);
assert(
  rootTerminalRows.length === 1 &&
    rootTerminalRows[0].task_status === 'completed' &&
    rootTerminalRows[0].run_status === 'succeeded',
  'durable_root_terminal_success_invalid',
);
await writeFile(
  `${evidenceRoot}/workflow.json`,
  JSON.stringify(
    {
      root_task_id: rootTaskId,
      team_status: projection.project.status,
      root_terminal: rootTerminalRows[0],
      work: workRows,
      attempts: attemptRows,
      create_receipts: createReceipts,
      dependencies: dependencyRows,
      request_changes: requestChanges,
      accepts: acceptReceipts,
      nonterminal_children: nonterminalChildren,
      effective_concurrency: effectiveConcurrency,
      chronological,
    },
    null,
    2,
  ),
);
const workspaceRows = await query(
  `SELECT m.name,m.role,rs.id AS runtime_session_id,rs.paseo_workspace_id FROM runtime_sessions rs JOIN team_member_runs m ON m.runtime_session_id=rs.id JOIN team_runs tr ON tr.id=m.team_run_id WHERE tr.root_task_id=$1 ORDER BY m.name`,
  [rootTaskId],
);
assert(
  workspaceRows.length === 3,
  'paseo_workspace_member_cardinality_invalid',
);
assert(
  workspaceRows.every(
    (row) =>
      ['lead', 'fixer', 'reviewer'].includes(row.name) &&
      row.paseo_workspace_id &&
      String(row.paseo_workspace_id).trim(),
  ),
  'paseo_workspace_member_missing',
);
const distinctWorkspaceCount = new Set(
  workspaceRows.map((row) => row.paseo_workspace_id),
).size;
assert(distinctWorkspaceCount === 1, 'paseo_workspace_cardinality_invalid');
await writeFile(
  `${evidenceRoot}/workspace.json`,
  JSON.stringify(
    {
      members: workspaceRows,
      distinct_workspace_count: distinctWorkspaceCount,
    },
    null,
    2,
  ),
);
await writeFile(
  `${evidenceRoot}/dispatch-order.json`,
  JSON.stringify(
    {
      fixer_v1: fixerV1,
      reviewer_v1: reviewerV1,
      queued_review_lead: requestChanges,
    },
    null,
    2,
  ),
);
const artifact = 'mixed_team_rework.py';
const artifactV1 = 'mixed_team_rework.v1.py';
const python = await readFile(artifact);
const pythonV1 = await readFile(artifactV1);
const lineCount = (bytes) => {
  const lines = bytes.toString('utf8').split(/\r?\n/);
  return lines.at(-1) === '' ? lines.length - 1 : lines.length;
};
const runPython = (path) =>
  new Promise((resolve) =>
    execFile(
      'python3',
      [path, '--text', ''],
      { timeout: 10_000 },
      (error, stdout, stderr) =>
        resolve({
          exit_code: error
            ? Number.isInteger(error.code)
              ? error.code
              : 1
            : 0,
          stdout: String(stdout ?? '').slice(0, 500),
          stderr: String(stderr ?? error?.message ?? '').slice(-2000),
        }),
    ),
  );
const v1Run = await runPython(artifactV1);
const finalRun = await runPython(artifact);
assert(
  lineCount(pythonV1) >= 90 && lineCount(pythonV1) <= 130,
  'python_v1_line_count_invalid',
);
assert(
  lineCount(python) >= 90 && lineCount(python) <= 130,
  'python_final_line_count_invalid',
);
assert(
  v1Run.exit_code !== 0 && /indexerror/i.test(v1Run.stderr),
  'python_v1_empty_input_indexerror_missing',
);
assert(finalRun.exit_code === 0, 'python_final_empty_input_not_corrected');
let finalJson;
try {
  finalJson = JSON.parse(finalRun.stdout);
} catch {
  finalJson = null;
}
assert(
  finalJson?.count === 0 && finalJson?.first_token === null,
  'python_final_empty_json_contract_invalid',
);
await copyFile(artifactV1, `${evidenceRoot}/mixed_team_rework.v1.py`);
await copyFile(artifact, `${evidenceRoot}/mixed_team_rework.py`);
const artifactEvidence = {
  v1: {
    relative_path: 'mixed_team_rework.v1.py',
    line_count: lineCount(pythonV1),
    sha256: createHash('sha256').update(pythonV1).digest('hex'),
    empty_input_run: v1Run,
  },
  final: {
    relative_path: 'mixed_team_rework.py',
    line_count: lineCount(python),
    sha256: createHash('sha256').update(python).digest('hex'),
    empty_input_run: finalRun,
  },
};
await writeFile(
  `${evidenceRoot}/python-artifact.json`,
  JSON.stringify(artifactEvidence, null, 2),
);
const distinctModels = [
  ...new Set(
    providers
      .map((row) => row.model)
      .filter((model) => typeof model === 'string' && model.trim()),
  ),
].sort();
const resolvedModel = distinctModels.join(',');
assert(
  resolvedModel && !/scripted/i.test(resolvedModel),
  'composition_model_not_exact_non_scripted',
);
const memberModels = Object.fromEntries(
  providers.map((row) => [row.member_name, row.model]),
);
const exactMapping =
  providers.length === 3 &&
  providers.every(
    (row) =>
      expectedProviders[row.member_name]?.provider === row.provider &&
      expectedProviders[row.member_name]?.policy === row.model_policy_ref &&
      expectedProviders[row.member_name]?.model === row.model &&
      row.run_count > 0,
  );
const compositionProviderUsed = exactMapping && !scriptedRuntimeDetected;
assert(compositionProviderUsed, 'composition_provider_used_not_derived');
await writeFile(
  `${evidenceRoot}/manifest.json`,
  JSON.stringify(
    {
      schema: 'mixed-team-proof-v1',
      root_task_id: rootTaskId,
      composition: {
        provider_used: compositionProviderUsed,
        model: resolvedModel,
        models: memberModels,
        scripted_runtime: scriptedRuntimeDetected,
        members: ['lead', 'fixer', 'reviewer'],
      },
      ordering_mode: 'observed_dispatch_id_fifo_parallel_observed_concurrency',
      effective_concurrency: effectiveConcurrency,
      platform_sequence_guarantee: false,
      normal_concurrency_reachable: true,
      evidence: [
        'providers.json',
        'workflow.json',
        'workspace.json',
        'dispatch-order.json',
        'python-artifact.json',
        'mixed_team_rework.v1.py',
        'mixed_team_rework.py',
      ],
    },
    null,
    2,
  ),
);
await db.end();
console.log(
  JSON.stringify(
    {
      root_task_id: rootTaskId,
      evidence_dir: evidenceRoot,
      markers: ['FIXER_SUBMIT_V1', 'REVIEW_REJECT', 'FIXER_SUBMIT_V2'],
    },
    null,
    2,
  ),
);
