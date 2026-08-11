import pg from 'pg';

function fail(reason) {
  throw new Error(`S6_STATE_HONESTY_NEGATIVE_FAIL:${reason}`);
}

const teamRunId =
  process.env.S6_NORMAL_TEAM_RUN_ID ??
  '9ccbce64-ed68-4e2f-9127-9734fe2b3f3a';
const rootTaskId =
  process.env.S6_NORMAL_ROOT_TASK_ID ??
  '90afbd54-d1cc-4a34-843f-fae40c7b8c99';
const baseUrl =
  process.env.AGENT_SERVER_URL ??
  process.env.AGENT_SERVER_BASE_URL ??
  'http://127.0.0.1:3000';
const token =
  process.env.AGENT_SERVER_TOKEN ??
  process.env.AGENT_SERVER_SERVICE_TOKEN ??
  process.env.SERVICE_ACCOUNT_TOKEN;
const databaseUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
const owner = {
  tenantId: process.env.AGENT_TENANT_ID ?? 'tenant_local',
  workspaceId: process.env.AGENT_WORKSPACE_ID ?? 'workspace_main',
  principalType: process.env.AGENT_PRINCIPAL_TYPE ?? 'service_account',
  principalId: process.env.AGENT_PRINCIPAL_ID ?? 'svc_local',
};

if (!token) fail('token_missing');
if (!databaseUrl) fail('database_url_missing');

const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  const dbResult = await pool.query(
    `SELECT tr.id AS team_run_id,tr.status AS team_status,tr.stop_reason,
            NOT EXISTS (
              SELECT 1 FROM team_work_item_attempts attempt
               WHERE attempt.team_run_id=tr.id
                 AND attempt.status IN ('queued','running')
            ) AS no_active_attempts,
            NOT EXISTS (
              SELECT 1 FROM team_member_runs member
               WHERE member.team_run_id=tr.id AND member.role='member'
                 AND member.status NOT IN ('idle','stopped')
            ) AS all_members_idle,
            EXISTS (
              SELECT 1 FROM team_work_items work WHERE work.team_run_id=tr.id
            ) AND NOT EXISTS (
              SELECT 1 FROM team_work_items work
               WHERE work.team_run_id=tr.id AND work.status<>'accepted'
            ) AS all_work_accepted
       FROM team_runs tr
      WHERE tr.id=$1 AND tr.tenant_id=$2 AND tr.workspace_id=$3
        AND tr.principal_type=$4 AND tr.principal_id=$5`,
    [
      teamRunId,
      owner.tenantId,
      owner.workspaceId,
      owner.principalType,
      owner.principalId,
    ],
  );
  const db = dbResult.rows[0];
  if (!db) fail('db_team_missing_or_owner_mismatch');

  const response = await fetch(
    new URL(
      `/api/v1/team-runs:project?root_task_id=${encodeURIComponent(rootTaskId)}`,
      baseUrl,
    ),
    {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
      },
    },
  );
  const api = await response.json().catch(() => null);
  if (!response.ok) fail(`api_http_${response.status}`);
  if (api?.project?.team_run_id !== teamRunId) fail('api_team_mismatch');

  const dbGates = {
    no_active_attempts: db.no_active_attempts,
    all_members_idle: db.all_members_idle,
    all_work_accepted: db.all_work_accepted,
  };
  const apiGates = {
    no_active_attempts: api?.gates?.no_active_attempts,
    all_members_idle: api?.gates?.all_members_idle,
    all_work_accepted: api?.gates?.all_work_accepted,
  };
  if (JSON.stringify(apiGates) !== JSON.stringify(dbGates))
    fail('api_db_gate_mismatch');
  if (api?.stuck !== false) fail('normal_run_stuck_not_false');
  if (db.team_status !== 'succeeded' || db.stop_reason !== null)
    fail('normal_run_not_cleanly_succeeded');
  if (api?.decision_capture_status !== 'not_captured')
    fail('decision_capture_status_not_honest');
  if (Object.hasOwn(api ?? {}, 'decisions'))
    fail('not_captured_exposes_decisions');

  process.stdout.write(
    `${JSON.stringify({
      marker: 'S6_STATE_HONESTY_NEGATIVE_PASS',
      team_run_id: teamRunId,
      db_gates: dbGates,
      api_gates: apiGates,
      stuck: api.stuck,
      team_status: db.team_status,
      stop_reason: db.stop_reason,
      decision_capture_status: api.decision_capture_status,
      decisions_present: Object.hasOwn(api, 'decisions'),
    })}\n`,
  );
} finally {
  await pool.end();
}
