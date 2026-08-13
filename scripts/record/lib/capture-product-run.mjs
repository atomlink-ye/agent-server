import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { validateRecording } from '../../ci/validate-product-recording.mjs';
import {
  assertNoEnvironmentValues,
  createRecordingSanitizerAudit,
  finalizeRecordingSanitizerAudit,
  recordingSanitizerAuditEnabled,
  sanitizeRecording,
  sanitizeRunEventPayload,
  RUN_EVENT_PAYLOAD_KEYS,
  sha256,
  stableStringify,
} from './sanitize-recording.mjs';

const QUERY_DEFINITIONS = Object.freeze({
  team_runs: `SELECT tr.id,tr.tenant_id,tr.workspace_id,tr.principal_type,tr.principal_id,tr.root_task_id,tr.root_run_id,tr.team_version_id,tr.environment_version_id,tr.status,tr.phase,tr.final_text,tr.control_state,tr.revision,tr.lead_turn_count,tr.stop_reason,tr.completion_requested_by_run_id,tr.completion_approval_required,tr.created_at,tr.updated_at
    FROM team_runs tr WHERE tr.root_task_id=$1 AND tr.tenant_id=$2 AND tr.workspace_id=$3 AND tr.principal_type=$4 AND tr.principal_id=$5 ORDER BY tr.id`,
  team_work_items: `SELECT w.id,w.team_run_id,w.subject,w.description,w.status,w.owner_member_id,w.created_by_member_id,w.completion_summary,w.execution_task_id,w.tenant_id,w.workspace_id,w.principal_type,w.principal_id,w.created_at,w.updated_at,w.completed_at
    FROM team_work_items w JOIN team_runs tr ON tr.id=w.team_run_id WHERE tr.root_task_id=$1 AND tr.tenant_id=$2 AND tr.workspace_id=$3 AND tr.principal_type=$4 AND tr.principal_id=$5 AND w.tenant_id=$2 AND w.workspace_id=$3 AND w.principal_type=$4 AND w.principal_id=$5 ORDER BY w.id`,
  team_work_item_attempts: `SELECT a.id,a.work_item_id,a.team_run_id,a.attempt_no,a.assignee_member_id,a.requested_by_lead_task_id,a.feedback,a.execution_task_id,a.status,a.result_summary,a.tenant_id,a.workspace_id,a.principal_type,a.principal_id,a.created_at,a.updated_at,a.completed_at
    FROM team_work_item_attempts a JOIN team_runs tr ON tr.id=a.team_run_id WHERE tr.root_task_id=$1 AND tr.tenant_id=$2 AND tr.workspace_id=$3 AND tr.principal_type=$4 AND tr.principal_id=$5 AND a.tenant_id=$2 AND a.workspace_id=$3 AND a.principal_type=$4 AND a.principal_id=$5 ORDER BY a.id`,
  team_messages: `SELECT m.id,m.team_run_id,m.tenant_id,m.workspace_id,m.principal_type,m.principal_id,m.sequence,m.sender_member_run_id,m.recipient_member_run_id,m.work_item_id,m.attempt_id,m.kind,m.status,m.consumed_by_task_id,m.created_at,m.consumed_at
    FROM team_messages m JOIN team_runs tr ON tr.id=m.team_run_id WHERE tr.root_task_id=$1 AND tr.tenant_id=$2 AND tr.workspace_id=$3 AND tr.principal_type=$4 AND tr.principal_id=$5 AND m.tenant_id=$2 AND m.workspace_id=$3 AND m.principal_type=$4 AND m.principal_id=$5 ORDER BY m.id`,
  run_events: `SELECT e.id,e.run_id,e.sequence,e.type,e.payload,e.created_at
    FROM run_events e JOIN runs r ON r.id=e.run_id JOIN tasks t ON t.id=r.task_id JOIN team_runs tr ON tr.root_task_id=t.root_task_id
    WHERE t.root_task_id=$1 AND t.tenant_id=$2 AND t.workspace_id=$3 AND t.principal_type=$4 AND t.principal_id=$5 AND tr.tenant_id=$2 AND tr.workspace_id=$3 AND tr.principal_type=$4 AND tr.principal_id=$5 ORDER BY e.id`,
});

const PRODUCT_QUERY_DEFINITIONS = Object.freeze({
  ...QUERY_DEFINITIONS,
  works: `SELECT w.id,w.tenant_id,w.workspace_id,w.definition_id,w.current_definition_version_id,w.title,w.origin,w.archived_at,w.created_at,w.updated_at
    FROM works w JOIN work_runs wr ON wr.work_id=w.id
      JOIN tasks t ON t.id=wr.root_task_id
    WHERE wr.root_task_id=$1 AND w.tenant_id=$2 AND w.workspace_id=$3
      AND wr.tenant_id=$2 AND wr.workspace_id=$3
      AND t.tenant_id=$2 AND t.workspace_id=$3::text
      AND t.principal_type=$4 AND t.principal_id=$5
    ORDER BY w.id`,
  work_runs: `SELECT wr.id,wr.tenant_id,wr.workspace_id,wr.work_id,wr.definition_version_id,wr.trigger_kind,wr.trigger_ref,wr.root_task_id,wr.expires_at,wr.bound_at,wr.created_at,wr.updated_at
    FROM work_runs wr JOIN tasks t ON t.id=wr.root_task_id
    WHERE wr.root_task_id=$1 AND wr.tenant_id=$2 AND wr.workspace_id=$3
      AND t.tenant_id=$2 AND t.workspace_id=$3::text
      AND t.principal_type=$4 AND t.principal_id=$5
    ORDER BY wr.id`,
  work_run_resource_manifest: `SELECT m.work_run_id,m.tenant_id,m.workspace_id,m.slot,m.resource_kind,m.requested_ref,m.resolved_version_id,m.resolved_fingerprint,m.resolved_at
    FROM work_run_resource_manifest m JOIN work_runs wr ON wr.id=m.work_run_id
      JOIN tasks t ON t.id=wr.root_task_id
    WHERE wr.root_task_id=$1 AND m.tenant_id=$2 AND m.workspace_id=$3
      AND wr.tenant_id=$2 AND wr.workspace_id=$3
      AND t.tenant_id=$2 AND t.workspace_id=$3::text
      AND t.principal_type=$4 AND t.principal_id=$5
    ORDER BY m.work_run_id,m.slot`,
});

const IDENTIFIER =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const scenarioNames = new Set([
  'parallel-success',
  'rework-once',
  'lead-never-accept',
  'oi38-negative',
]);
export const SUBMIT_INSTRUCTION_PROFILE =
  'canonical-team-work-submit-hard-gate/v1';
const expectedMemberCompositions = Object.freeze({
  'parallel-success': [
    'projection-lead',
    'projection-worker-a',
    'projection-worker-b',
  ],
  'rework-once': [
    'projection-lead',
    'projection-worker',
    'projection-reviewer',
  ],
  'lead-never-accept': [
    'projection-lead',
    'projection-worker',
    'projection-observer',
  ],
  'oi38-negative': [
    'projection-lead',
    'projection-worker-a',
    'projection-worker-b',
  ],
});

function assertInput(options) {
  for (const key of [
    'baseUrl',
    'token',
    'rootTaskId',
    'tenantId',
    'workspaceId',
    'principalId',
    'scenario',
  ])
    if (!options[key]) throw new Error(`capture_${key}_required`);
  if (!IDENTIFIER.test(options.rootTaskId))
    throw new Error('capture_root_task_id_invalid');
  if (!scenarioNames.has(options.scenario))
    throw new Error('capture_scenario_invalid');
  const expectedComposition = expectedMemberCompositions[options.scenario];
  if (
    !Array.isArray(options.memberComposition) ||
    options.memberComposition.join('\n') !== expectedComposition.join('\n')
  )
    throw new Error('capture_member_composition_invalid');
  if (options.submitInstructionProfile !== SUBMIT_INSTRUCTION_PROFILE)
    throw new Error('capture_submit_instruction_profile_invalid');
  const provider = String(
    options.providerKind ?? process.env.PASEO_PROVIDER ?? '',
  );
  if (!provider || /fake|scripted|stub|mock/iu.test(provider))
    throw new Error('fake_or_scripted_provider_rejected');
  return provider;
}

async function getJson(baseUrl, token, path) {
  const response = await fetch(new URL(path, baseUrl), {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`capture_http_${response.status}`);
  return body;
}

async function queryRows(client, sql, values, name) {
  const result = await client.query(sql, values);
  return {
    name,
    sql: sql.replace(/\s+/gu, ' ').trim(),
    rows: result.rows,
    row_count: result.rowCount ?? result.rows.length,
  };
}

export function runEventProjection(rows, collector) {
  return rows.map((row) => {
    const payload = structuredClone(row.payload);
    if (
      payload?.detail &&
      typeof payload.detail === 'object' &&
      !Array.isArray(payload.detail) &&
      Object.hasOwn(payload.detail, 'content')
    )
      payload.detail.content = '[REDACTED]';
    return {
      ...row,
      payload: sanitizeRunEventPayload(
        payload,
        `run_events.${row.id}.payload`,
        { collector },
      ),
    };
  });
}

export function assertScenarioPredicate(
  scenario,
  teamRows,
  workRows,
  attemptRows,
) {
  if (scenario === 'oi38-negative') {
    if (
      teamRows.every((row) => row.status === 'succeeded') &&
      attemptRows.some((row) => row.status === 'completed' && row.completed_at)
    )
      return;
    throw new Error('oi38_negative_live_run_predicate_failed');
  }
  const predicateScenario = scenario;
  if (predicateScenario === 'parallel-success') {
    const accepted = workRows.filter((row) => row.status === 'accepted');
    const completed = attemptRows.filter(
      (row) => row.status === 'completed' && row.completed_at,
    );
    const overlap = completed.some((left, index) =>
      completed
        .slice(index + 1)
        .some(
          (right) =>
            left.work_item_id !== right.work_item_id &&
            new Date(left.created_at) <= new Date(right.completed_at) &&
            new Date(right.created_at) <= new Date(left.completed_at),
        ),
    );
    const attemptsByWork = new Map();
    for (const row of attemptRows) {
      const attempts = attemptsByWork.get(row.work_item_id) ?? [];
      attempts.push(row);
      attemptsByWork.set(row.work_item_id, attempts);
    }
    if (
      teamRows.every((row) => row.status === 'succeeded') &&
      accepted.length >= 2 &&
      workRows.length === 2 &&
      workRows.every((row) => row.status === 'accepted') &&
      workRows.every((row) => (attemptsByWork.get(row.id) ?? []).length >= 1) &&
      attemptRows.every((row) => !String(row.feedback ?? '').trim()) &&
      overlap
    )
      return;
    throw new Error('parallel_success_live_predicate_failed');
  }
  if (predicateScenario === 'rework-once') {
    const attemptsByWork = new Map();
    for (const row of attemptRows) {
      const attempts = attemptsByWork.get(row.work_item_id) ?? [];
      attempts.push(row);
      attemptsByWork.set(row.work_item_id, attempts);
    }
    const reworked = [...attemptsByWork.entries()].some(
      ([workId, attempts]) => {
        const ordered = [...attempts].sort(
          (left, right) => left.attempt_no - right.attempt_no,
        );
        return (
          workRows.some(
            (work) => work.id === workId && work.status === 'accepted',
          ) &&
          ordered.some(
            (later, index) =>
              later.status === 'completed' &&
              String(later.feedback ?? '').trim() &&
              ordered
                .slice(0, index)
                .some((earlier) => earlier.attempt_no < later.attempt_no),
          )
        );
      },
    );
    if (teamRows.every((row) => row.status === 'succeeded') && reworked) return;
    throw new Error('rework_once_live_predicate_failed');
  }
  if (
    teamRows.every((row) => ['active', 'waiting'].includes(row.status)) &&
    workRows.some((row) => row.status === 'completed') &&
    workRows.every((row) => row.status !== 'accepted')
  )
    return;
  throw new Error('lead_never_accept_live_predicate_failed');
}

function assertOi38PredicateEvidence(
  evidence,
  workId,
  work,
  workRun,
  workRows,
  workRunRows,
) {
  if (!evidence || evidence.owner_work_id !== workId)
    throw new Error('capture_oi38_owner_work_id_mismatch');
  if (!IDENTIFIER.test(evidence.missing_work_id) || evidence.missing_work_id === workId)
    throw new Error('capture_oi38_missing_work_id_invalid');
  if (work?.id !== workId || workRun?.work_id !== workId)
    throw new Error('capture_oi38_api_lineage_mismatch');
  if (
    !workRows.some(
      (row) =>
        row.id === workId &&
        row.tenant_id === work.tenant_id &&
        row.workspace_id === work.workspace_id,
    ) ||
    !workRunRows.some(
      (row) =>
        row.id === workRun.id &&
        row.work_id === workId &&
        row.tenant_id === work.tenant_id &&
        row.workspace_id === work.workspace_id,
    )
  )
    throw new Error('capture_oi38_db_lineage_mismatch');
  for (const name of ['owner', 'foreign', 'missing']) {
    const response = evidence[name];
    if (
      !response ||
      !Number.isInteger(response.status) ||
      !response.body ||
      typeof response.body !== 'object' ||
      Array.isArray(response.body)
    )
      throw new Error(`capture_oi38_${name}_response_incomplete`);
  }
  const ownerRuns = evidence.owner.body.work_runs;
  if (
    evidence.owner.status !== 200 ||
    !Array.isArray(ownerRuns) ||
    ownerRuns.length < 1 ||
    !Object.hasOwn(evidence.owner.body, 'next_cursor') ||
    ownerRuns.some((row) => row?.work_id !== workId) ||
    ownerRuns.some(
      (row) =>
        !workRunRows.some(
          (dbRow) => dbRow.id === row.id && dbRow.work_id === workId,
        ),
    )
  )
    throw new Error('capture_oi38_owner_response_lineage_mismatch');
  if (
    evidence.foreign.status !== 404 ||
    evidence.missing.status !== 404 ||
    evidence.foreign.body.error?.code !== 'work_not_found' ||
    evidence.missing.body.error?.code !== 'work_not_found' ||
    typeof evidence.foreign.body.error?.request_id !== 'string' ||
    !evidence.foreign.body.error.request_id ||
    typeof evidence.missing.body.error?.request_id !== 'string' ||
    !evidence.missing.body.error.request_id
  )
    throw new Error('capture_oi38_negative_control_invalid');
  const normalize = (response) => {
    const body = structuredClone(response.body);
    if (body?.error) delete body.error.request_id;
    return stableStringify(body);
  };
  if (normalize(evidence.foreign) !== normalize(evidence.missing))
    throw new Error('capture_oi38_negative_envelope_mismatch');
}

export async function writeJson(path, value, collector) {
  if (collector) assertNoEnvironmentValues(value, process.env, { collector });
  const scanPath = collector ? auditPath(path) : path;
  const isRunEvents =
    path === 'run_events.json' || path.endsWith('/run_events.json');
  const isManifest =
    path === 'manifest.json' || path.endsWith('/manifest.json');
  const safe = sanitizeRecording(value, scanPath, {
    allowKeys: isRunEvents ? RUN_EVENT_PAYLOAD_KEYS : undefined,
    allowExactValues: isManifest
      ? new Map([['provider_run', new Set(['real'])]])
      : undefined,
    allowProviderSummary: path.endsWith('/trace.json') || isManifest,
    collector,
  });
  if (!collector) assertNoEnvironmentValues(safe);
  await writeFile(path, stableStringify(safe), { mode: 0o600 });
}

function auditPath(path) {
  const marker = path.lastIndexOf('.tmp-');
  if (marker < 0) return path;
  const separator = path.indexOf('/', marker);
  return separator < 0 ? path : path.slice(separator + 1);
}

function recordingName(recordedAt, rootTaskId) {
  return `${recordedAt.replace(/[-:.]/gu, '').replace(/Z$/u, 'Z')}-${rootTaskId}`;
}

export async function capturePreIdentity(options) {
  const providerKind = assertInput(options);
  const audit = recordingSanitizerAuditEnabled()
    ? createRecordingSanitizerAudit()
    : null;
  const baseUrl = new URL(options.baseUrl);
  const outputRoot = resolve(
    options.outputRoot ??
      new URL(
        '../../../fixtures/product-projection/recordings',
        import.meta.url,
      ).pathname,
  );
  const recordedAt = new Date().toISOString();
  const target = join(
    outputRoot,
    options.scenario,
    recordingName(recordedAt, options.rootTaskId),
  );
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  const sqlValues = [
    options.rootTaskId,
    options.tenantId,
    options.workspaceId,
    options.principalType ?? 'service_account',
    options.principalId,
  ];
  const client =
    options.client ??
    new Client({
      connectionString:
        options.databaseUrl ??
        process.env.DATABASE_URL ??
        process.env.POSTGRES_URL,
    });
  let connected = false;
  try {
    if (!options.client) {
      await client.connect();
      connected = true;
    }
    const captures = [];
    for (const [name, sql] of Object.entries(QUERY_DEFINITIONS))
      captures.push(await queryRows(client, sql, sqlValues, name));
    const teamRows = captures.find((entry) => entry.name === 'team_runs').rows;
    if (!teamRows.length) throw new Error('capture_team_run_missing');
    if (
      !teamRows.every(
        (row) =>
          row.root_task_id === options.rootTaskId &&
          row.tenant_id === options.tenantId &&
          row.workspace_id === options.workspaceId,
      )
    )
      throw new Error('capture_scope_mismatch');
    const byName = new Map(captures.map((entry) => [entry.name, entry.rows]));
    assertScenarioPredicate(
      options.scenario,
      teamRows,
      byName.get('team_work_items'),
      byName.get('team_work_item_attempts'),
    );
    const trace = {
      task: await getJson(
        baseUrl,
        options.token,
        `/api/v1/tasks/${options.rootTaskId}`,
      ),
      tree: await getJson(
        baseUrl,
        options.token,
        `/api/v1/tasks/${options.rootTaskId}/tree`,
      ),
      team_run: await getJson(
        baseUrl,
        options.token,
        `/api/v1/tasks/${options.rootTaskId}/team-run`,
      ),
      project:
        options.project ??
        (await getJson(
          baseUrl,
          options.token,
          `/api/v1/team-runs:project?root_task_id=${encodeURIComponent(options.rootTaskId)}`,
        )),
    };
    await mkdir(join(temporary, 'api'), { recursive: true, mode: 0o700 });
    await mkdir(join(temporary, 'db'), { recursive: true, mode: 0o700 });
    await writeJson(join(temporary, 'api/trace.json'), trace, audit);
    for (const name of [
      'team_runs',
      'team_work_items',
      'team_work_item_attempts',
      'team_messages',
    ])
      await writeJson(
        join(temporary, `db/${name}.json`),
        byName.get(name),
        audit,
      );
    await writeJson(
      join(temporary, 'db/run_events.json'),
      runEventProjection(byName.get('run_events'), audit),
      audit,
    );
    const startedAt =
      options.startedAt ??
      teamRows.reduce(
        (min, row) =>
          new Date(row.created_at) < new Date(min) ? row.created_at : min,
        teamRows[0].created_at,
      );
    const manifest = {
      format_version: 'product-projection-recording/v1',
      mode: 'pre-identity',
      scenario: options.scenario,
      scenario_definition: true,
      member_composition: options.memberComposition,
      submit_instruction_profile: options.submitInstructionProfile,
      definition_hash: options.definitionHash ?? 'unrecorded',
      provider_run: 'real',
      provider: {
        kind: providerKind,
        model:
          options.providerModel ?? process.env.PASEO_MODEL ?? '[configured]',
      },
      root_task_id: options.rootTaskId,
      git_sha:
        options.gitSha ??
        process.env.GIT_SHA ??
        process.env.PRODUCT_LINEAGE_SOURCE_REVISION ??
        options.serviceRevision ??
        'unknown',
      work_id: { capture_status: 'not_applicable' },
      work_run_id: { capture_status: 'not_applicable' },
      tenant_id: options.tenantId,
      workspace_id: options.workspaceId,
      principal_type: options.principalType ?? 'service_account',
      principal_id: options.principalId,
      started_at: new Date(startedAt).toISOString(),
      recorded_at: recordedAt,
      service_revision:
        options.serviceRevision ?? process.env.SERVICE_REVISION ?? 'unknown',
      predicate_evidence: options.predicateEvidence ?? {},
      files: {},
      queries: captures.map(({ name, sql, row_count }) => ({
        name,
        sql,
        parameters: [
          '$1:<redacted>',
          '$2:<redacted>',
          '$3:<redacted>',
          '$4:<redacted>',
          '$5:<redacted>',
        ],
        row_count,
      })),
    };
    for (const name of [
      'api/trace.json',
      'db/team_runs.json',
      'db/team_work_items.json',
      'db/team_work_item_attempts.json',
      'db/team_messages.json',
      'db/run_events.json',
    ]) {
      const bytes = await readFile(join(temporary, name));
      manifest.files[name] = {
        row_count: name === 'api/trace.json' ? 1 : JSON.parse(bytes).length,
        sha256: sha256(bytes),
      };
    }
    await writeJson(join(temporary, 'manifest.json'), manifest, audit);
    if (audit) finalizeRecordingSanitizerAudit(audit);
    const checksumFiles = ['manifest.json', ...Object.keys(manifest.files)];
    const checksums = [];
    for (const name of checksumFiles)
      checksums.push(
        `${sha256(await readFile(join(temporary, name)))}  ${name}`,
      );
    await writeFile(
      join(temporary, 'SHA256SUMS'),
      `${checksums.join('\n')}\n`,
      { mode: 0o600 },
    );
    const validation = await validateRecording(temporary, 'pre-identity');
    await mkdir(resolve(target, '..'), { recursive: true, mode: 0o700 });
    await rename(temporary, target);
    return {
      directory: target,
      rootTaskId: options.rootTaskId,
      scenario: options.scenario,
      providerKind,
      validation,
    };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(
      () => undefined,
    );
    throw error;
  } finally {
    if (connected) await client.end();
  }
}

export async function captureProductRun(options) {
  const providerKind = assertInput(options);
  const audit = recordingSanitizerAuditEnabled()
    ? createRecordingSanitizerAudit()
    : null;
  if (!options.workId || !IDENTIFIER.test(options.workId))
    throw new Error('capture_work_id_required');
  if (!options.workRunId || !IDENTIFIER.test(options.workRunId))
    throw new Error('capture_work_run_id_required');
  if (!options.work || !options.workRun || !options.trace)
    throw new Error('capture_product_api_response_required');
  if (options.work.id !== options.workId)
    throw new Error('capture_work_identity_mismatch');
  if (
    options.workRun.id !== options.workRunId ||
    options.workRun.work_id !== options.workId
  )
    throw new Error('capture_work_run_identity_mismatch');
  const baseUrl = new URL(options.baseUrl);

  // Historical captures must preserve the exact accepted API envelopes.  Do
  // not normalize or repair these values: a schema failure is a closed gate
  // before any recording file is created.
  const { register: registerTsx } = await import('tsx/esm/api');
  registerTsx();
  const {
    ProductRunTraceResponseSchema,
    ProductWorkRunResponseSchema,
  } = await import('../../../src/contracts/product-projection/index.ts');
  const workRunResponse =
    options.workRunResponse ??
    (await getJson(
      baseUrl,
      options.token,
      `/api/v1/works/${options.workId}/runs/${options.workRunId}`,
    ));
  ProductWorkRunResponseSchema.parse(workRunResponse);
  ProductRunTraceResponseSchema.parse(options.trace);
  const outputRoot = resolve(
    options.outputRoot ??
      new URL(
        '../../../fixtures/product-projection/recordings',
        import.meta.url,
      ).pathname,
  );
  const recordedAt = new Date().toISOString();
  const target = join(
    outputRoot,
    options.scenario,
    recordingName(recordedAt, options.rootTaskId),
  );
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  const sqlValues = [
    options.rootTaskId,
    options.tenantId,
    options.workspaceId,
    options.principalType ?? 'service_account',
    options.principalId,
  ];
  const client =
    options.client ??
    new Client({
      connectionString:
        options.databaseUrl ??
        process.env.DATABASE_URL ??
        process.env.POSTGRES_URL,
    });
  let connected = false;
  try {
    if (!options.client) {
      await client.connect();
      connected = true;
    }
    const captures = [];
    for (const [name, sql] of Object.entries(PRODUCT_QUERY_DEFINITIONS))
      captures.push(await queryRows(client, sql, sqlValues, name));
    const byName = new Map(captures.map((entry) => [entry.name, entry.rows]));
    const teamRows = byName.get('team_runs');
    if (!teamRows?.length) throw new Error('capture_team_run_missing');
    if (
      !teamRows.every(
        (row) =>
          row.root_task_id === options.rootTaskId &&
          row.tenant_id === options.tenantId &&
          row.workspace_id === options.workspaceId,
      )
    )
      throw new Error('capture_scope_mismatch');
    const works = byName.get('works');
    const workRuns = byName.get('work_runs');
    const resources = byName.get('work_run_resource_manifest');
    if (
      !works.some(
        (row) =>
          row.id === options.workId &&
          row.tenant_id === options.tenantId &&
          row.workspace_id === options.workspaceId,
      ) ||
      !workRuns.some(
        (row) =>
          row.id === options.workRunId &&
          row.work_id === options.workId &&
          row.tenant_id === options.tenantId &&
          row.workspace_id === options.workspaceId,
      ) ||
      resources.some((row) => row.work_run_id !== options.workRunId)
    )
      throw new Error('capture_product_db_identity_mismatch');
    assertScenarioPredicate(
      options.scenario,
      teamRows,
      byName.get('team_work_items'),
      byName.get('team_work_item_attempts'),
    );
    if (options.scenario === 'oi38-negative')
      assertOi38PredicateEvidence(
        options.predicateEvidence?.oi38,
        options.workId,
        options.work,
        options.workRun,
        works,
        workRuns,
      );
    await mkdir(join(temporary, 'api'), { recursive: true, mode: 0o700 });
    await mkdir(join(temporary, 'db'), { recursive: true, mode: 0o700 });
    await writeJson(join(temporary, 'api/work.json'), options.work, audit);
    await writeJson(
      join(temporary, 'api/work-run.json'),
      options.workRun,
      audit,
    );
    await writeJson(join(temporary, 'api/trace.json'), options.trace, audit);
    for (const name of [
      'team_runs',
      'team_work_items',
      'team_work_item_attempts',
      'team_messages',
      'works',
      'work_runs',
      'work_run_resource_manifest',
    ])
      await writeJson(
        join(temporary, `db/${name}.json`),
        byName.get(name),
        audit,
      );
    await writeJson(
      join(temporary, 'db/run_events.json'),
      runEventProjection(byName.get('run_events'), audit),
      audit,
    );
    const startedAt = teamRows.reduce(
      (min, row) =>
        new Date(row.created_at) < new Date(min) ? row.created_at : min,
      teamRows[0].created_at,
    );
    const manifest = {
      format_version: 'product-projection-recording/v1',
      mode: 'product',
      scenario: options.scenario,
      scenario_definition: true,
      member_composition: options.memberComposition,
      submit_instruction_profile: options.submitInstructionProfile,
      definition_hash: options.definitionHash ?? 'unrecorded',
      provider_run: 'real',
      provider: {
        kind: providerKind,
        model:
          options.providerModel ?? process.env.PASEO_MODEL ?? '[configured]',
      },
      root_task_id: options.rootTaskId,
      git_sha:
        options.gitSha ??
        process.env.GIT_SHA ??
        process.env.PRODUCT_LINEAGE_SOURCE_REVISION ??
        options.serviceRevision ??
        'unknown',
      work_id: options.workId,
      work_run_id: options.workRunId,
      tenant_id: options.tenantId,
      workspace_id: options.workspaceId,
      principal_type: options.principalType ?? 'service_account',
      principal_id: options.principalId,
      started_at: new Date(startedAt).toISOString(),
      recorded_at: recordedAt,
      service_revision:
        options.serviceRevision ?? process.env.SERVICE_REVISION ?? 'unknown',
      predicate_evidence: options.predicateEvidence ?? {},
      accepted_subset: {
        endpoint_count: 7,
        endpoints: [
          'GET /api/v1/works',
          'GET /api/v1/works/{work_id}',
          'POST /api/v1/works',
          'GET /api/v1/works/{work_id}/runs',
          'POST /api/v1/works/{work_id}/runs',
          'GET /api/v1/works/{work_id}/runs/{work_run_id}',
          'GET /api/v1/works/{work_id}/runs/{work_run_id}/trace',
        ],
        controls: {
          cancel_work_run: 'explicitly_unavailable',
          decide_completion: 'explicitly_unavailable',
        },
      },
      files: {},
      queries: captures.map(({ name, sql, row_count }) => ({
        name,
        sql: sql.replace(/\s+/gu, ' ').trim(),
        parameters: [
          '$1:<redacted>',
          '$2:<redacted>',
          '$3:<redacted>',
          '$4:<redacted>',
          '$5:<redacted>',
        ],
        row_count,
      })),
    };
    for (const name of [
      'api/work.json',
      'api/work-run.json',
      'api/trace.json',
      'db/team_runs.json',
      'db/team_work_items.json',
      'db/team_work_item_attempts.json',
      'db/team_messages.json',
      'db/run_events.json',
      'db/works.json',
      'db/work_runs.json',
      'db/work_run_resource_manifest.json',
    ]) {
      const bytes = await readFile(join(temporary, name));
      manifest.files[name] = {
        row_count: name.startsWith('db/') ? JSON.parse(bytes).length : 1,
        sha256: sha256(bytes),
      };
    }
    await writeJson(join(temporary, 'manifest.json'), manifest, audit);
    if (audit) finalizeRecordingSanitizerAudit(audit);
    const checksumFiles = ['manifest.json', ...Object.keys(manifest.files)];
    await writeFile(
      join(temporary, 'SHA256SUMS'),
      `${(await Promise.all(checksumFiles.map(async (name) => `${sha256(await readFile(join(temporary, name)))}  ${name}`))).join('\n')}\n`,
      { mode: 0o600 },
    );
    const validation = await validateRecording(temporary, 'product');
    await mkdir(resolve(target, '..'), { recursive: true, mode: 0o700 });
    await rename(temporary, target);
    return {
      directory: target,
      rootTaskId: options.rootTaskId,
      workId: options.workId,
      workRunId: options.workRunId,
      scenario: options.scenario,
      providerKind,
      validation,
    };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(
      () => undefined,
    );
    throw error;
  } finally {
    if (connected) await client.end();
  }
}
