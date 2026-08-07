// Local-only proof seed for one mixed-provider ManagedTeam run.
// It intentionally does not start a runtime or use scripted execution.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client as PostgresClient } from 'pg';

const exec = promisify(execFile);
const baseUrl = process.env.AGENT_SERVER_BASE_URL ?? 'http://127.0.0.1:3000';
const token = process.env.AGENT_SERVER_SERVICE_TOKEN ?? 'token-local-dev';
const workspaceId = process.env.AGENT_SERVER_WORKSPACE_ID ?? 'workspace_main';
const timeoutMs = Number(process.env.MIXED_TEAM_TIMEOUT_MS ?? 180_000);
const startedAt = Date.now();

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
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const modelPolicies = Object.freeze({ lead: 'free-only', fixer: 'claude/deepseek-v4-flash', reviewer: 'codex/deepseek-v4-flash' });

function instructions(name) {
  if (name === 'lead') return `Act directly as Lead using only canonical Team tools. Never spawn, delegate, use provider subagents, or call shell/filesystem tools. Read the board first and perform the exact next legal control action, then stop. On an empty board create exactly one Work assigned to fixer: subject "Implement mixed_team_rework.py" and description exactly "Create a useful self-contained Python utility in repo-root relative mixed_team_rework.py. The first attempt must be 90-130 lines, executable, manually run, and submit marker FIXER_SUBMIT_V1 while deliberately retaining one explicit empty-input acceptance defect for review." Do not create reviewer Work on this turn. When fixer Work has a completed latest attempt containing FIXER_SUBMIT_V1, do not accept it; on that next Lead turn create exactly one Work assigned to reviewer with subject "Review mixed_team_rework.py" and description exactly "Read and run mixed_team_rework.py, genuinely detect the declared empty-input acceptance defect, and submit marker REVIEW_REJECT with the exact blocking reason." Do not accept or finish on that creation turn. When reviewer Work is completed with REVIEW_REJECT, accept reviewer Work and request changes on fixer Work in the same turn, passing the reviewer's exact blocking feedback as feedback. When fixer has a completed FIXER_SUBMIT_V2 attempt, accept fixer Work. When every Work is accepted and no active attempts remain, call team_finish exactly once. Never repeat successful mutations, invent refs, or substitute prose for a canonical action.`;
  if (name === 'fixer') return `Act directly as the assigned fixer using canonical Team tools plus the available workspace terminal. Do not create or mutate another Work and do not use provider subagents. For attempt 1, discover the repository root with git (never embed an absolute path), write a useful self-contained Python utility to repo-root relative mixed_team_rework.py with about 100 lines (accepted range 90-130), manually run it, compute line count and sha256, and submit a completed result containing marker FIXER_SUBMIT_V1. Deliberately leave one explicit acceptance defect: empty input must be mishandled in a clearly observable way. After the first submit, stop. On a request_changes attempt, read the exact feedback, edit the same relative file to correct the empty-input defect without changing its purpose, run it with both non-empty and empty input, recompute line count and sha256, and submit marker FIXER_SUBMIT_V2 with the verification facts. Never use absolute paths in prompts or results, never send messages, and never repeat a successful submit.`;
  return `Act directly as the assigned reviewer using canonical Team tools plus the available workspace terminal. Do not create or mutate another Work and do not use provider subagents. Read and run repo-root relative mixed_team_rework.py. Genuinely inspect the first version, detect its declared empty-input acceptance defect, and submit a completed result containing marker REVIEW_REJECT and exact blocking reason: "empty input is mishandled: the utility indexes the first token instead of returning an empty result." Include the relative path and a safe run observation. Do not edit the file, do not accept Work, never send messages, and stop after one submit.`;
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
const agents = {};
for (const name of ['lead', 'fixer', 'reviewer']) agents[name] = await importAndPublish(agentYaml(name), '/api/v1/agents:import', (id) => `/api/v1/agent-versions/${id}:publish`);
const environment = await importAndPublish(environmentYaml, '/api/v1/environments:import', (id) => `/api/v1/environment-versions/${id}:publish`);
const team = await request('/api/v1/teams:import', { method: 'POST', body: { source: teamYaml(agents.lead, agents.fixer, agents.reviewer, environment) }, status: 201 });
const publishedTeam = await request(`/api/v1/team-versions/${team.version.id}:publish`, { method: 'POST', body: {} });
const invoked = await request('/api/v1/tasks:invoke', { method: 'POST', status: 202, body: { invokable: { kind: 'team', version_id: publishedTeam.id }, input: { text: 'Produce one mixed-provider TeamRun proof for mixed_team_rework.py.' }, workspace_id: workspaceId } });
const rootTaskId = invoked.task_id;
await writeFile('.local/web-bootstrap.env', [`WEB_WORKSPACE_ID=${workspaceId}`, 'WEB_WORKSPACE_NAME=Mixed-provider TeamRun proof', `WEB_AGENTIC_TEAM_VERSION_ID=${publishedTeam.id}`, `WEB_ENVIRONMENT_VERSION_ID=${environment}`, `WEB_AGENT_VERSION_ID=${agents.fixer}`, ''].join('\n'));

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
const db = process.env.POSTGRES_ADMIN_URL ? new PostgresClient({ connectionString: process.env.POSTGRES_ADMIN_URL }) : null;
assert(db, 'POSTGRES_ADMIN_URL_required_for_durable_evidence');
await db.connect();
const query = async (text, values = []) => (await db.query(text, values)).rows;
const providers = await query(`SELECT m.name AS member_name, m.role, av.policy_snapshot->>'modelPolicyRef' AS model_policy_ref, r.runtime->>'provider' AS provider, r.runtime->>'model' AS model, count(*)::int AS run_count FROM team_runs tr JOIN team_member_runs m ON m.team_run_id=tr.id JOIN agent_versions av ON av.id=m.agent_version_id JOIN tasks t ON t.team_member_run_id=m.id AND t.root_task_id=tr.root_task_id JOIN runs r ON r.task_id=t.id WHERE tr.root_task_id=$1 AND r.status='succeeded' GROUP BY m.name,m.role,av.policy_snapshot,r.runtime->>'provider',r.runtime->>'model' ORDER BY m.name`, [rootTaskId]);
const expectedProviders = { lead: 'free-only', fixer: 'claude/deepseek-v4-flash', reviewer: 'codex/deepseek-v4-flash' };
assert(providers.length === 3, 'provider_mapping_cardinality_invalid');
for (const row of providers) { assert(row.model_policy_ref === expectedProviders[row.member_name], `provider_policy_mismatch_${row.member_name}`); assert(row.provider === (row.member_name === 'lead' ? 'opencode' : row.member_name), `provider_mismatch_${row.member_name}`); assert(!String(row.model ?? '').includes('scripted'), 'scripted_model_detected'); }
await writeFile(`${evidenceRoot}/providers.json`, JSON.stringify(providers, null, 2));
const workflow = await query(`SELECT w.id AS work_ref,w.subject,w.status AS work_status,m.name AS assignee_name,a.attempt_no,a.status AS attempt_status,a.result_summary,a.feedback FROM team_work_items w JOIN team_member_runs m ON m.id=w.owner_member_id LEFT JOIN team_work_item_attempts a ON a.work_item_id=w.id WHERE w.team_run_id=(SELECT id FROM team_runs WHERE root_task_id=$1) ORDER BY w.created_at,a.attempt_no`, [rootTaskId]);
assert(workflow.some((r) => r.assignee_name === 'reviewer' && r.result_summary?.includes('REVIEW_REJECT')), 'review_reject_missing');
assert(workflow.some((r) => r.assignee_name === 'fixer' && r.attempt_no === 2 && r.result_summary?.includes('FIXER_SUBMIT_V2')), 'fixer_rework_missing');
await writeFile(`${evidenceRoot}/workflow.json`, JSON.stringify({ root_task_id: rootTaskId, team_status: projection.project.status, work: workflow }, null, 2));
const workspaceRows = await query(`SELECT DISTINCT rs.paseo_workspace_id FROM runtime_sessions rs JOIN team_member_runs m ON m.runtime_session_id=rs.id JOIN team_runs tr ON tr.id=m.team_run_id WHERE tr.root_task_id=$1 AND rs.paseo_workspace_id IS NOT NULL AND btrim(rs.paseo_workspace_id)<>''`, [rootTaskId]);
assert(workspaceRows.length === 1, 'paseo_workspace_cardinality_invalid');
await writeFile(`${evidenceRoot}/workspace.json`, JSON.stringify({ paseo_workspace_ids: workspaceRows.map((r) => r.paseo_workspace_id) }, null, 2));
const dispatchRows = await query(`SELECT t.team_task_kind,t.id AS task_id,r.id AS run_id,m.name,d.id AS dispatch_id,d.created_at AS dispatch_created_at,min(e.created_at) FILTER (WHERE e.type='started') AS started_at,max(e.created_at) FILTER (WHERE e.type IN ('succeeded','failed','timed_out','cancelled')) AS terminal_at FROM tasks t JOIN runs r ON r.task_id=t.id LEFT JOIN run_dispatches d ON d.run_id=r.id AND d.event_type='run.enqueue' LEFT JOIN run_events e ON e.run_id=r.id LEFT JOIN team_member_runs m ON m.id=t.team_member_run_id WHERE t.root_task_id=$1 GROUP BY t.team_task_kind,t.id,r.id,m.name,d.id,d.created_at ORDER BY d.id`, [rootTaskId]);
const reviewerDispatch = dispatchRows.find((r) => r.name === 'reviewer');
const nextLead = dispatchRows.find((r) => r.name === 'lead' && reviewerDispatch && Number(r.dispatch_id) > Number(reviewerDispatch.dispatch_id));
assert(reviewerDispatch?.terminal_at && nextLead?.started_at, 'dispatch_order_rows_missing');
assert(new Date(reviewerDispatch.terminal_at) <= new Date(nextLead.started_at), 'reviewer_terminal_after_queued_lead_start');
await writeFile(`${evidenceRoot}/dispatch-order.json`, JSON.stringify({ reviewer: reviewerDispatch, queued_lead: nextLead }, null, 2));
const root = (await exec('git', ['rev-parse', '--show-toplevel'])).stdout.trim();
const artifact = `${root}/mixed_team_rework.py`;
const python = await readFile(artifact);
const lineCount = python.toString('utf8').split(/\r?\n/).length - 1;
assert(lineCount >= 90 && lineCount <= 130, 'python_line_count_invalid');
const sha256 = createHash('sha256').update(python).digest('hex');
await copyFile(artifact, `${evidenceRoot}/mixed_team_rework.py`);
await writeFile(`${evidenceRoot}/python-artifact.json`, JSON.stringify({ relative_path: 'mixed_team_rework.py', line_count: lineCount, sha256 }, null, 2));
await writeFile(`${evidenceRoot}/manifest.json`, JSON.stringify({ schema: 'mixed-team-proof-v1', root_task_id: rootTaskId, composition: { provider_used: true, scripted_runtime: false, members: ['lead', 'fixer', 'reviewer'] }, ordering_mode: 'demo_deterministic_fifo_single_dispatcher', platform_sequence_guarantee: false, normal_concurrency_reachable: true, evidence: ['providers.json', 'workflow.json', 'workspace.json', 'dispatch-order.json', 'python-artifact.json', 'mixed_team_rework.py'] }, null, 2));
await db.end();
console.log(JSON.stringify({ root_task_id: rootTaskId, evidence_dir: evidenceRoot, markers: ['FIXER_SUBMIT_V1', 'REVIEW_REJECT', 'FIXER_SUBMIT_V2'] }, null, 2));
