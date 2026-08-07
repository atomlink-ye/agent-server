// Local-only proof seed for one mixed-provider ManagedTeam run.
// It intentionally does not start a runtime or use scripted execution.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { Client as PostgresClient } from 'pg';

const baseUrl = process.env.AGENT_SERVER_BASE_URL ?? 'http://127.0.0.1:3000';
const token = process.env.AGENT_SERVER_SERVICE_TOKEN ?? 'token-local-dev';
const workspaceId = process.env.AGENT_SERVER_WORKSPACE_ID ?? 'workspace_main';
const timeoutMs = Number(process.env.MIXED_TEAM_TIMEOUT_MS ?? 900_000);
const startedAt = Date.now();
const databaseUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
const packageMarker = JSON.parse(await readFile('package.json', 'utf8'));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
assert(packageMarker.name === '@atomlink-ye/agent-server', 'agent_server_working_directory_required');
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
const modelPolicies = Object.freeze({ lead: 'free-only', fixer: 'claude/deepseek-v4-flash', reviewer: 'codex/deepseek-v4-flash' });

function instructions(name) {
  if (name === 'lead') return `Act directly as Lead using only canonical Team tools. Never spawn, delegate, use provider subagents, or call shell/filesystem tools. Read the board first and perform the exact next legal control action, then stop. On an empty board create exactly one Work assigned to fixer: subject "Implement mixed_team_rework.py" and description exactly "Create a useful self-contained Python utility in repo-root relative mixed_team_rework.py. The first attempt must be 90-130 lines, executable, manually run, and submit marker FIXER_SUBMIT_V1 while deliberately retaining one explicit empty-input acceptance defect for review." Do not create reviewer Work on this turn. When fixer Work has a completed latest attempt containing FIXER_SUBMIT_V1, do not accept it; on that next Lead turn create exactly one Work assigned to reviewer with subject "Review mixed_team_rework.py" and description exactly "Read and run mixed_team_rework.py, genuinely detect the declared empty-input acceptance defect, and submit marker REVIEW_REJECT with the exact blocking reason." Do not accept or finish on that creation turn. When reviewer Work is completed with REVIEW_REJECT, accept reviewer Work and request changes on fixer Work in the same turn, passing the reviewer's exact blocking feedback as feedback. When fixer has a completed FIXER_SUBMIT_V2 attempt, accept fixer Work. When every Work is accepted and no active attempts remain, call team_finish exactly once. Never repeat successful mutations, invent refs, or substitute prose for a canonical action.`;
  if (name === 'fixer') return `HARD GATE: A prose-only turn is invalid; the first assistant block must be a workspace terminal tool call, with no text emitted before tool use. Do not end until both required relative files, mixed_team_rework.py and mixed_team_rework.v1.py, exist and the canonical team_work_submit call returns success. Act directly as the assigned fixer using canonical Team tools plus the available workspace terminal. Do not create or mutate another Work and do not use provider subagents. Build a useful self-contained JSON token-summary CLI that accepts --text and emits deterministic JSON with count and first_token. Starting from the current working directory, walk parent directories until package.json has name @atomlink-ye/agent-server and compose.yaml is present; never use version-control commands or print an absolute path. For attempt 1, write it to repo-root relative mixed_team_rework.py with about 100 lines (accepted range 90-130), and intentionally implement the acceptance defect by indexing tokens[0], so running --text '' fails with IndexError. Manually run it, copy that exact defective file to mixed_team_rework.v1.py before submitting, compute lines and sha256 for both, and submit marker FIXER_SUBMIT_V1. After the first submit, stop. On request_changes, locate the same workspace without absolute paths, edit the same file so --text '' succeeds with JSON {"count":0,"first_token":null}, run non-empty and empty cases, recompute line count and sha256, and submit marker FIXER_SUBMIT_V2. Never use absolute paths in prompts or results, never send messages, and never repeat a successful submit.`;
  return `Act directly as the assigned reviewer using canonical Team tools plus the available workspace terminal. Do not create or mutate another Work and do not use provider subagents. Starting from the current working directory, walk parent directories until package.json has name @atomlink-ye/agent-server and compose.yaml is present; never use version-control commands or print an absolute path. Then read and run repo-root relative mixed_team_rework.v1.py (the preserved first attempt) with --text ''. Genuinely verify the declared tokens[0] defect produces an IndexError, and submit a completed result containing marker REVIEW_REJECT and exact blocking reason: "empty input is mishandled: the utility indexes the first token instead of returning an empty result." Include the relative path and safe run observation. Do not edit either file, do not accept Work, never send messages, and stop after one submit.`;
}
function agentYaml(name) {
  const refs = name === 'lead' ? ['team-state', 'team-work-list', 'team-work-create', 'team-work-accept-v2', 'team-work-request-changes', 'team-finish'] : ['team-state', 'team-work-list', 'team-work-checkpoint', 'team-work-submit'];
  return `apiVersion: agent-server/v1alpha1\nkind: ManagedAgent\nmetadata:\n  name: ${name}\nspec:\n  description: Mixed-provider TeamRun proof role\n  instructions: ${JSON.stringify(instructions(name))}\n  runtime:\n    provider: paseo\n    modelPolicyRef: ${modelPolicies[name]}\n    mode: isolated\n  tools:\n${refs.map((ref) => `    - ref: agent-server/${ref}\n      kind: tool`).join('\n')}\n  skills: []\n  input:\n    schema:\n      type: object\n      properties: {}\n      additionalProperties: false\n    prompt: "Execute exactly the next legal Team transition for your role."\n  session:\n    invocation: fresh_per_invocation\n    followUps: queued\n    binding: reusable\n  memory:\n    policy: workspace_snapshot\n    proposalLimit: 0\n  permissions:\n    network: read_only\n    filesystem: workspace_read\n  completion:\n    type: executable\n    command: "done"\n`;
}
const environmentYaml = `apiVersion: agent-server/v1alpha1\nkind: ManagedEnvironment\nmetadata:\n  name: mixed-provider-proof\nspec:\n  adapter: paseo\n  provider: opencode\n  modelPolicyRef: free-only\n  runtimeCellPolicy: per_runtime_session\n`;
const teamYaml = (lead, fixer, reviewer, environment) => `apiVersion: agent-server/v1alpha1\nkind: ManagedTeam\nmetadata:\n  name: mixed-provider-proof-team\nspec:\n  environmentVersionId: ${environment}\n  lead:\n    name: lead\n    agentVersionId: ${lead}\n  roster:\n    - name: fixer\n      agentVersionId: ${fixer}\n    - name: reviewer\n      agentVersionId: ${reviewer}\n  coordination:\n    taskAssignment: lead_or_self_claim\n`;
async function importAndPublish(source, importPath, publishPath) {
  const imported = await request(importPath, { method: 'POST', body: { source }, status: 201 });
  await request(publishPath(imported.version.id), { method: 'POST', body: {} });
  return imported.version.id;
}
const existingRootTaskId = process.env.MIXED_TEAM_EXISTING_ROOT_TASK_ID?.trim();
let rootTaskId;
if (existingRootTaskId) {
  rootTaskId = existingRootTaskId;
} else {
  const agents = {};
  for (const name of ['lead', 'fixer', 'reviewer']) agents[name] = await importAndPublish(agentYaml(name), '/api/v1/agents:import', (id) => `/api/v1/agent-versions/${id}:publish`);
  const environment = await importAndPublish(environmentYaml, '/api/v1/environments:import', (id) => `/api/v1/environment-versions/${id}:publish`);
  const team = await request('/api/v1/teams:import', { method: 'POST', body: { source: teamYaml(agents.lead, agents.fixer, agents.reviewer, environment) }, status: 201 });
  const publishedTeam = await request(`/api/v1/team-versions/${team.version.id}:publish`, { method: 'POST', body: {} });
  const invoked = await request('/api/v1/tasks:invoke', { method: 'POST', status: 202, body: { invokable: { kind: 'team', version_id: publishedTeam.id }, input: { text: 'Produce one mixed-provider TeamRun proof for mixed_team_rework.py.' }, workspace_id: workspaceId } });
  rootTaskId = invoked.task_id;
  await writeFile('.local/web-bootstrap.env', [`WEB_WORKSPACE_ID=${workspaceId}`, 'WEB_WORKSPACE_NAME=Mixed-provider TeamRun proof', `WEB_AGENTIC_TEAM_VERSION_ID=${publishedTeam.id}`, `WEB_ENVIRONMENT_VERSION_ID=${environment}`, `WEB_AGENT_VERSION_ID=${agents.fixer}`, ''].join('\n'));
}

let projection;
let terminalTask;
while (Date.now() - startedAt < timeoutMs) {
  terminalTask = await request(`/api/v1/tasks/${rootTaskId}`);
  projection = await request(`/api/v1/team-runs:project?root_task_id=${encodeURIComponent(rootTaskId)}`);
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
const providers = await query(`SELECT m.name AS member_name, m.role, av.policy_snapshot->>'modelPolicyRef' AS model_policy_ref, r.runtime->>'provider' AS provider, r.runtime->>'model' AS model, count(*)::int AS run_count FROM team_runs tr JOIN team_member_runs m ON m.team_run_id=tr.id JOIN agent_versions av ON av.id=m.agent_version_id JOIN tasks t ON t.team_member_run_id=m.id AND t.root_task_id=tr.root_task_id JOIN runs r ON r.task_id=t.id WHERE tr.root_task_id=$1 AND r.status='succeeded' GROUP BY m.name,m.role,av.policy_snapshot,r.runtime->>'provider',r.runtime->>'model' ORDER BY m.name`, [rootTaskId]);
const expectedProviders = { lead: { policy: 'free-only', provider: 'opencode', model: 'opencode-go/deepseek-v4-flash' }, fixer: { policy: 'claude/deepseek-v4-flash', provider: 'claude', model: 'deepseek-v4-flash' }, reviewer: { policy: 'codex/deepseek-v4-flash', provider: 'codex', model: 'deepseek-v4-flash' } };
assert(providers.length === 3, 'provider_mapping_cardinality_invalid');
for (const row of providers) { const expected = expectedProviders[row.member_name]; assert(expected, `unexpected_provider_member_${row.member_name}`); assert(row.run_count > 0, `provider_run_count_invalid_${row.member_name}`); assert(row.model_policy_ref === expected.policy, `provider_policy_mismatch_${row.member_name}`); assert(row.provider === expected.provider, `provider_mismatch_${row.member_name}`); assert(row.model === expected.model, `model_mismatch_${row.member_name}`); }
const scriptedRuntimeDetected = providers.some((row) => /scripted/i.test(`${row.provider} ${row.model}`));
assert(!scriptedRuntimeDetected, 'scripted_model_detected');
await writeFile(`${evidenceRoot}/providers.json`, JSON.stringify(providers, null, 2));
const workRows = await query(`SELECT w.id AS work_ref,w.subject,w.status AS work_status,w.created_at,w.updated_at,m.name AS assignee_name,m.role AS assignee_role,c.name AS created_by_name,c.role AS created_by_role FROM team_work_items w JOIN team_member_runs m ON m.id=w.owner_member_id JOIN team_member_runs c ON c.id=w.created_by_member_id WHERE w.team_run_id=(SELECT id FROM team_runs WHERE root_task_id=$1) ORDER BY w.created_at`, [rootTaskId]);
const attemptRows = await query(`SELECT a.id AS attempt_ref,a.work_item_id AS work_ref,a.attempt_no,a.status AS attempt_status,a.result_summary,a.feedback,a.created_at,a.updated_at,a.completed_at,m.name AS assignee_name FROM team_work_item_attempts a JOIN team_member_runs m ON m.id=a.assignee_member_id WHERE a.team_run_id=(SELECT id FROM team_runs WHERE root_task_id=$1) ORDER BY a.created_at`, [rootTaskId]);
const reviewReason = 'empty input is mishandled: the utility indexes the first token instead of returning an empty result.';
assert(workRows.length === 2 && workRows.every((row) => row.work_status === 'accepted'), 'exactly_two_accepted_work_items_required');
assert(workRows.every((row) => row.created_by_name === 'lead' && row.created_by_role === 'lead'), 'work_creator_must_be_lead');
assert(attemptRows.length === 3, 'exactly_three_attempts_required');
const fixerV1 = attemptRows.find((row) => row.assignee_name === 'fixer' && row.attempt_no === 1);
const reviewerV1 = attemptRows.find((row) => row.assignee_name === 'reviewer' && row.attempt_no === 1);
const fixerV2 = attemptRows.find((row) => row.assignee_name === 'fixer' && row.attempt_no === 2);
assert(fixerV1?.attempt_status === 'completed' && fixerV1.result_summary?.includes('FIXER_SUBMIT_V1'), 'fixer_v1_invalid');
assert(reviewerV1?.attempt_status === 'completed' && reviewerV1.result_summary?.includes('REVIEW_REJECT'), 'reviewer_reject_invalid');
assert(fixerV2?.attempt_status === 'completed' && fixerV2.result_summary?.includes('FIXER_SUBMIT_V2'), 'fixer_v2_invalid');
assert(new Date(workRows.find((row) => row.assignee_name === 'reviewer').created_at) > new Date(fixerV1.completed_at ?? fixerV1.updated_at), 'reviewer_created_before_fixer_v1_completion');
assert(new Date(fixerV2.created_at) > new Date(reviewerV1.updated_at), 'fixer_v2_created_before_reviewer_rejection');
assert(fixerV2.feedback?.includes(reviewReason), 'fixer_v2_feedback_missing_exact_review_reason');
const chronological = [...workRows.map((row) => ({ kind: 'work', ...row })), ...attemptRows.map((row) => ({ kind: 'attempt', ...row }))].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
const terminalTeam = await query(`SELECT status,phase,updated_at FROM team_runs WHERE root_task_id=$1`, [rootTaskId]);
assert(terminalTeam.length === 1 && terminalTeam[0].status === 'succeeded', 'durable_team_terminal_status_invalid');
await writeFile(`${evidenceRoot}/workflow.json`, JSON.stringify({ root_task_id: rootTaskId, team_status: projection.project.status, work: workRows, attempts: attemptRows, chronological }, null, 2));
const workspaceRows = await query(`SELECT m.name,m.role,rs.id AS runtime_session_id,rs.paseo_workspace_id FROM runtime_sessions rs JOIN team_member_runs m ON m.runtime_session_id=rs.id JOIN team_runs tr ON tr.id=m.team_run_id WHERE tr.root_task_id=$1 ORDER BY m.name`, [rootTaskId]);
assert(workspaceRows.length === 3, 'paseo_workspace_member_cardinality_invalid');
assert(workspaceRows.every((row) => ['lead', 'fixer', 'reviewer'].includes(row.name) && row.paseo_workspace_id && String(row.paseo_workspace_id).trim()), 'paseo_workspace_member_missing');
const distinctWorkspaceCount = new Set(workspaceRows.map((row) => row.paseo_workspace_id)).size;
assert(distinctWorkspaceCount === 1, 'paseo_workspace_cardinality_invalid');
await writeFile(`${evidenceRoot}/workspace.json`, JSON.stringify({ members: workspaceRows, distinct_workspace_count: distinctWorkspaceCount }, null, 2));
const dispatchRows = await query(`SELECT t.team_task_kind,t.id AS task_id,r.id AS run_id,m.name,d.id AS dispatch_id,d.created_at AS dispatch_created_at,min(e.created_at) FILTER (WHERE e.type='started') AS started_at,max(e.created_at) FILTER (WHERE e.type IN ('succeeded','failed','timed_out','cancelled')) AS terminal_at FROM tasks t JOIN runs r ON r.task_id=t.id LEFT JOIN run_dispatches d ON d.run_id=r.id AND d.event_type='run.enqueue' LEFT JOIN run_events e ON e.run_id=r.id LEFT JOIN team_member_runs m ON m.id=t.team_member_run_id WHERE t.root_task_id=$1 GROUP BY t.team_task_kind,t.id,r.id,m.name,d.id,d.created_at ORDER BY d.id`, [rootTaskId]);
const reviewerDispatch = dispatchRows.find((r) => r.name === 'reviewer');
const nextLead = dispatchRows.find((r) => r.name === 'lead' && reviewerDispatch && Number(r.dispatch_id) > Number(reviewerDispatch.dispatch_id));
assert(reviewerDispatch?.terminal_at && nextLead?.started_at, 'dispatch_order_rows_missing');
assert(new Date(reviewerDispatch.terminal_at) <= new Date(nextLead.started_at), 'reviewer_terminal_after_queued_lead_start');
await writeFile(`${evidenceRoot}/dispatch-order.json`, JSON.stringify({ reviewer: reviewerDispatch, queued_lead: nextLead }, null, 2));
const artifact = 'mixed_team_rework.py';
const artifactV1 = 'mixed_team_rework.v1.py';
const python = await readFile(artifact);
const pythonV1 = await readFile(artifactV1);
const lineCount = (bytes) => { const lines = bytes.toString('utf8').split(/\r?\n/); return lines.at(-1) === '' ? lines.length - 1 : lines.length; };
const runPython = (path) => new Promise((resolve) => execFile('python3', [path, '--text', ''], { timeout: 10_000 }, (error, stdout, stderr) => resolve({ exit_code: error ? (Number.isInteger(error.code) ? error.code : 1) : 0, stdout: String(stdout ?? '').slice(0, 500), stderr: String(stderr ?? error?.message ?? '').slice(0, 500) })));
const v1Run = await runPython(artifactV1);
const finalRun = await runPython(artifact);
assert(lineCount(pythonV1) >= 90 && lineCount(pythonV1) <= 130, 'python_v1_line_count_invalid');
assert(lineCount(python) >= 90 && lineCount(python) <= 130, 'python_final_line_count_invalid');
assert(v1Run.exit_code !== 0 && /indexerror/i.test(v1Run.stderr), 'python_v1_empty_input_indexerror_missing');
assert(finalRun.exit_code === 0, 'python_final_empty_input_not_corrected');
let finalJson;
try { finalJson = JSON.parse(finalRun.stdout); } catch { finalJson = null; }
assert(finalJson?.count === 0 && finalJson?.first_token === null, 'python_final_empty_json_contract_invalid');
await copyFile(artifactV1, `${evidenceRoot}/mixed_team_rework.v1.py`);
await copyFile(artifact, `${evidenceRoot}/mixed_team_rework.py`);
const artifactEvidence = { v1: { relative_path: 'mixed_team_rework.v1.py', line_count: lineCount(pythonV1), sha256: createHash('sha256').update(pythonV1).digest('hex'), empty_input_run: v1Run }, final: { relative_path: 'mixed_team_rework.py', line_count: lineCount(python), sha256: createHash('sha256').update(python).digest('hex'), empty_input_run: finalRun } };
await writeFile(`${evidenceRoot}/python-artifact.json`, JSON.stringify(artifactEvidence, null, 2));
const distinctModels = [...new Set(providers.map((row) => row.model).filter((model) => typeof model === 'string' && model.trim()))].sort();
const resolvedModel = distinctModels.join(',');
assert(resolvedModel && !/scripted/i.test(resolvedModel), 'composition_model_not_exact_non_scripted');
const memberModels = Object.fromEntries(providers.map((row) => [row.member_name, row.model]));
const exactMapping = providers.length === 3 && providers.every((row) => expectedProviders[row.member_name]?.provider === row.provider && expectedProviders[row.member_name]?.policy === row.model_policy_ref && expectedProviders[row.member_name]?.model === row.model && row.run_count > 0);
const compositionProviderUsed = exactMapping && !scriptedRuntimeDetected;
assert(compositionProviderUsed, 'composition_provider_used_not_derived');
await writeFile(`${evidenceRoot}/manifest.json`, JSON.stringify({ schema: 'mixed-team-proof-v1', root_task_id: rootTaskId, composition: { provider_used: compositionProviderUsed, model: resolvedModel, models: memberModels, scripted_runtime: scriptedRuntimeDetected, members: ['lead', 'fixer', 'reviewer'] }, ordering_mode: 'demo_deterministic_fifo_single_dispatcher', platform_sequence_guarantee: false, normal_concurrency_reachable: true, evidence: ['providers.json', 'workflow.json', 'workspace.json', 'dispatch-order.json', 'python-artifact.json', 'mixed_team_rework.v1.py', 'mixed_team_rework.py'] }, null, 2));
await db.end();
console.log(JSON.stringify({ root_task_id: rootTaskId, evidence_dir: evidenceRoot, markers: ['FIXER_SUBMIT_V1', 'REVIEW_REJECT', 'FIXER_SUBMIT_V2'] }, null, 2));
