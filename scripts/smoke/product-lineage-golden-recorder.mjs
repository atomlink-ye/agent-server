import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  mkdir,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

const REQUIRED_TABLES = Object.freeze([
  'works',
  'work_runs',
  'team_runs',
  'team_member_runs',
  'team_work_items',
  'team_work_item_attempts',
  'team_work_item_dependencies',
  'team_messages',
  'tasks',
  'runs',
  'run_events',
]);

const OWNER_COLUMNS = Object.freeze([
  'tenant_id',
  'workspace_id',
  'principal_type',
  'principal_id',
]);
const SAFE_COLUMNS = Object.freeze({
  works: ['id', 'tenant_id', 'workspace_id', 'definition_id', 'current_definition_version_id', 'title', 'origin', 'archived_at', 'created_at', 'updated_at'],
  work_runs: ['id', 'tenant_id', 'workspace_id', 'work_id', 'definition_version_id', 'trigger_kind', 'trigger_ref', 'root_task_id', 'expires_at', 'bound_at', 'created_at', 'updated_at'],
  team_runs: ['id', 'tenant_id', 'workspace_id', 'principal_type', 'principal_id', 'root_task_id', 'root_run_id', 'status', 'phase', 'created_at', 'updated_at', 'revision', 'control_state', 'stop_reason'],
  team_member_runs: ['id', 'team_run_id', 'name', 'role', 'agent_version_id', 'runtime_session_id', 'status', 'current_work_item_id', 'tenant_id', 'workspace_id', 'principal_type', 'principal_id', 'created_at', 'updated_at'],
  team_work_items: ['id', 'team_run_id', 'subject', 'description', 'status', 'owner_member_id', 'created_by_member_id', 'execution_task_id', 'tenant_id', 'workspace_id', 'principal_type', 'principal_id', 'created_at', 'updated_at', 'completed_at'],
  team_work_item_attempts: ['id', 'work_item_id', 'team_run_id', 'attempt_no', 'assignee_member_id', 'requested_by_lead_task_id', 'execution_task_id', 'status', 'tenant_id', 'workspace_id', 'principal_type', 'principal_id', 'created_at', 'updated_at', 'completed_at'],
  team_work_item_dependencies: ['team_run_id', 'work_item_id', 'depends_on_work_item_id', 'tenant_id', 'workspace_id', 'principal_type', 'principal_id', 'created_at'],
  team_messages: ['id', 'team_run_id', 'tenant_id', 'workspace_id', 'principal_type', 'principal_id', 'sequence', 'sender_member_run_id', 'recipient_member_run_id', 'work_item_id', 'attempt_id', 'kind', 'dedup_key', 'status', 'consumed_by_task_id', 'created_at', 'consumed_at'],
  tasks: ['id', 'tenant_id', 'root_task_id', 'parent_task_id', 'parent_run_id', 'depth', 'status', 'created_at', 'updated_at', 'team_member_run_id', 'team_sequence', 'team_task_kind', 'source_team_message_id'],
  runs: ['id', 'task_id', 'attempt', 'status', 'created_at', 'updated_at'],
  run_events: ['id', 'run_id', 'sequence', 'type', 'created_at'],
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function asText(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function asRecordedValue(table, key, value) {
  if (
    key === 'sequence' &&
    (table === 'team_messages' || table === 'run_events') &&
    typeof value === 'string' &&
    /^\d+$/u.test(value)
  )
    return Number(value);
  return asText(value);
}

async function writeAtomicFile(path, value) {
  const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(tmp, value, { mode: 0o600 });
  await rename(tmp, path);
  await chmod(path, 0o600);
}

async function availableColumns(db, table) {
  const result = await db.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
    [table],
  );
  return new Set(result.rows.map((row) => row.column_name));
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function ownerPredicates(columns, alias = '') {
  const prefix = alias ? `${quoteIdentifier(alias)}.` : '';
  return OWNER_COLUMNS.filter((column) => columns.has(column)).map(
    (column) => `${prefix}${quoteIdentifier(column)}=$${OWNER_COLUMNS.indexOf(column) + 1}`,
  );
}

/**
 * Capture the minimum real product lineage bundle.  This function deliberately
 * refuses scripted providers and refuses incomplete source objects: there is
 * no fallback fixture and no INSERT path here.
 */
export async function recordProductLineageGolden({
  db,
  rootTaskId,
  teamRunId,
  providerRun,
  serviceRevision,
  productWorkRunRaw,
  productTraceRaw,
  correlation,
  sourceCounts,
  providerEvidence,
  outputPath = process.env.PRODUCT_LINEAGE_GOLDEN_OUTPUT,
} = {}) {
  if (!outputPath) return { recorded: false, reason: 'disabled' };
  if (providerRun !== 'real')
    throw new Error('golden_recorder_requires_real_provider_run');
  if (!db || !rootTaskId || !teamRunId)
    throw new Error('golden_recorder_durable_identity_missing');
  if (
    !productWorkRunRaw ||
    !productTraceRaw ||
    !correlation ||
    !sourceCounts ||
    !providerEvidence
  )
    throw new Error('golden_recorder_product_raw_not_ready');
  if (
    !OWNER_COLUMNS.every(
      (column) => typeof correlation[column] === 'string' && correlation[column],
    )
  )
    throw new Error('golden_recorder_owner_correlation_missing');
  if (!correlation.work_id || !correlation.work_run_id)
    throw new Error('golden_recorder_product_correlation_missing');
  if (!/^[0-9a-f]{7,40}$/u.test(serviceRevision ?? ''))
    throw new Error('golden_recorder_source_revision_invalid');
  if (
    typeof providerEvidence.provider !== 'string' ||
    !providerEvidence.provider ||
    typeof providerEvidence.model !== 'string' ||
    !providerEvidence.model ||
    !/^[0-9a-f]{64}$/u.test(providerEvidence.root_run_sha256 ?? '') ||
    !/^[0-9a-f]{64}$/u.test(providerEvidence.provider_run_sha256 ?? '')
  )
    throw new Error('golden_recorder_provider_evidence_invalid');

  const columnSets = new Map();
  const tables = {};
  const queryNames = {};
  const queryRowCounts = {};
  for (const table of REQUIRED_TABLES) {
    const columns = await availableColumns(db, table);
    columnSets.set(table, columns);
    if (!columns.has('id') && table !== 'team_work_item_dependencies')
      throw new Error(`golden_recorder_table_missing:${table}`);
  }
  const teamRunColumns = columnSets.get('team_runs');
  const taskColumns = columnSets.get('tasks');
  const teamRunScope = [
    '"tr"."id"=$5',
    '"tr"."root_task_id"=$6',
    ...ownerPredicates(teamRunColumns, 'tr'),
  ].join(' AND ');
  const taskScope = (alias = '') => {
    const prefix = alias ? `${quoteIdentifier(alias)}.` : '';
    const parts = [`${prefix}${quoteIdentifier('root_task_id')}=$6`];
    parts.push(...ownerPredicates(taskColumns, alias));
    return parts.join(' AND ');
  };
  const runScope = (alias = '') => {
    const prefix = alias ? `${quoteIdentifier(alias)}.` : '';
    const parts = [
      `${prefix}${quoteIdentifier('task_id')} IN (SELECT "t"."id" FROM "tasks" "t" WHERE ${taskScope('t')})`,
    ];
    parts.push(...ownerPredicates(columnSets.get('runs'), alias));
    return parts.join(' AND ');
  };

  for (const table of REQUIRED_TABLES) {
    const columns = columnSets.get(table);
    const selected = (SAFE_COLUMNS[table] ?? []).filter((column) => columns.has(column));
    // Add bounded presence projections instead of text-bearing columns.
    const presence = [];
    if (table === 'team_work_item_attempts') {
      if (columns.has('feedback')) presence.push('feedback IS NOT NULL AS feedback_present');
      if (columns.has('result_summary'))
        presence.push('result_summary IS NOT NULL AS result_present');
    }
    if (table === 'team_messages' && columns.has('body'))
      presence.push('body IS NOT NULL AS body_present');
    if (table === 'run_events' && columns.has('payload'))
      presence.push("payload IS NOT NULL AND payload <> '{}'::jsonb AS payload_present");
    if (table === 'runs' && columns.has('runtime')) {
      presence.push("runtime->>'provider' AS provider", "runtime->>'model' AS model");
    }
    if (table === 'runs' && columns.has('result')) presence.push('result IS NOT NULL AS result_present');
    if (table === 'runs' && columns.has('error')) presence.push("error->>'code' AS error_code");
    const ownerScope = ownerPredicates(columns);
    let scope = [];
    if (table === 'works') {
      scope = columns.has('id') ? ['"id"=$7', ...ownerScope] : [];
    } else if (table === 'work_runs') {
      scope = ['id', 'work_id', 'root_task_id'].every((column) => columns.has(column))
        ? ['"id"=$8', '"work_id"=$7', '"root_task_id"=$6', ...ownerScope]
        : [];
    } else if (table === 'team_runs') {
      scope = ['id', 'root_task_id'].every((column) => columns.has(column))
        ? ['"id"=$5', '"root_task_id"=$6', ...ownerScope]
        : [];
    } else if (['team_member_runs', 'team_work_items', 'team_work_item_attempts', 'team_work_item_dependencies', 'team_messages'].includes(table)) {
      scope = columns.has('team_run_id')
        ? [`"team_run_id"=$5`, `EXISTS (SELECT 1 FROM "team_runs" "tr" WHERE ${teamRunScope})`, ...ownerScope]
        : [];
    } else if (table === 'tasks') {
      scope = columns.has('root_task_id') ? [taskScope(), `EXISTS (SELECT 1 FROM "team_runs" "tr" WHERE ${teamRunScope})`] : [];
    } else if (table === 'runs') {
      scope = columns.has('task_id') ? [runScope()] : [];
    } else if (table === 'run_events') {
      scope = columns.has('run_id')
        ? [`"run_id" IN (SELECT "r"."id" FROM "runs" "r" WHERE ${runScope('r')})`]
        : [];
    }
    const where = scope.length ? `WHERE ${scope.join(' AND ')}` : 'WHERE FALSE';
    const args = [
      correlation.tenant_id,
      correlation.workspace_id,
      correlation.principal_type,
      correlation.principal_id,
      teamRunId,
      rootTaskId,
      correlation.work_id,
      correlation.work_run_id,
    ];
    const bindCount = table === 'work_runs' ? 8 : table === 'works' ? 7 : 6;
    const select = [...selected.map(quoteIdentifier), ...presence].join(',');
    queryNames[table] = `golden.${table}`;
    const result = await db.query(
      `SELECT ${select || '1'} FROM ${quoteIdentifier(table)} ${where}`,
      args.slice(0, bindCount),
    );
    queryRowCounts[table] = result.rows.length;
    // Convert postgres Date values before deterministic serialization.
    tables[table] = result.rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key,
          asRecordedValue(table, key, value),
        ]),
      ),
    );
  }

  const correlationValue = {
    tenant_id: correlation.tenant_id,
    workspace_id: correlation.workspace_id,
    principal_type: correlation.principal_type,
    principal_id: correlation.principal_id,
  };
  const manifest = {
    format_version: 'product-lineage-golden-v1',
    provider_run: 'real',
    service_revision: serviceRevision,
    provider_evidence: providerEvidence,
    recorded_at: new Date().toISOString(),
    ids: {
      work_id: correlation.work_id,
      work_run_id: correlation.work_run_id,
      root_task_id: rootTaskId,
      team_run_id: teamRunId,
    },
    correlation: correlationValue,
    source_counts: sourceCounts,
    query_names: queryNames,
    query_row_counts: queryRowCounts,
    api_files: ['api/product-work-run.json', 'api/product-trace.json'],
    db_files: REQUIRED_TABLES.map((table) => `db/${table}.json`),
  };
  const files = new Map([
    ['api/product-work-run.json', json(productWorkRunRaw)],
    ['api/product-trace.json', json(productTraceRaw)],
    ...REQUIRED_TABLES.map((table) => [`db/${table}.json`, json(tables[table])]),
  ]);
  manifest.file_sha256 = Object.fromEntries(
    [...files.entries()].map(([path, value]) => [path, sha256(value)]),
  );
  files.set('manifest.json', json(manifest));
  const sums = [...files.entries()]
    .filter(([path]) => path !== 'SHA256SUMS')
    .map(([path, value]) => `${sha256(value)}  ${path}`)
    .join('\n') + '\n';
  files.set('SHA256SUMS', sums);

  const parent = outputPath.replace(/\/[^/]+$/u, '') || '.';
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const temp = `${outputPath}.tmp-${process.pid}-${randomUUID()}`;
  await mkdir(join(temp, 'api'), { recursive: true, mode: 0o700 });
  await mkdir(join(temp, 'db'), { recursive: true, mode: 0o700 });
  try {
    for (const [relative, value] of files) {
      const path = join(temp, relative);
      await writeAtomicFile(path, value);
    }
    await chmod(temp, 0o700);
    await rename(temp, outputPath);
  } catch (error) {
    await rm(temp, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  return { recorded: true, path: outputPath, files: [...files.keys()] };
}

export { REQUIRED_TABLES };
