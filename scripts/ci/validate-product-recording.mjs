import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  sha256,
  stableStringify,
  RUN_EVENT_PAYLOAD_KEYS,
  sanitizeRecording,
  sanitizeRunEventPayload,
  assertNoEnvironmentValues,
} from '../record/lib/sanitize-recording.mjs';

const PRE_FILES = Object.freeze([
  'manifest.json',
  'api/trace.json',
  'db/team_runs.json',
  'db/team_work_items.json',
  'db/team_work_item_attempts.json',
  'db/team_messages.json',
  'db/run_events.json',
  'SHA256SUMS',
]);
const PRODUCT_FILES = Object.freeze([
  'manifest.json',
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
  'SHA256SUMS',
]);
const QUERY_NAMES = Object.freeze([
  'run_events',
  'team_messages',
  'team_runs',
  'team_work_item_attempts',
  'team_work_items',
]);
const PRODUCT_QUERY_NAMES = Object.freeze(
  [...QUERY_NAMES, 'work_run_resource_manifest', 'work_runs', 'works'].sort(),
);
const SCENARIOS = new Set([
  'parallel-success',
  'rework-once',
  'lead-never-accept',
]);
const EXPECTED_MEMBER_COMPOSITIONS = Object.freeze({
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
});
const SUBMIT_INSTRUCTION_PROFILE = 'canonical-team-work-submit-hard-gate/v1';

function fail(code, detail = '') {
  throw new Error(`${code}${detail ? `:${detail}` : ''}`);
}

async function allFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) output.push(...(await allFiles(root, path)));
    else output.push(relative(root, path));
  }
  return output.sort();
}

function parseJson(text, file) {
  try {
    return JSON.parse(text);
  } catch {
    fail('invalid_json', file);
  }
}

function rows(value, file) {
  if (!Array.isArray(value)) fail('rows_must_be_array', file);
  return value;
}

function assertUuid(value, label) {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  )
    fail('invalid_uuid', label);
}

function assertQueries(manifest, mode) {
  if (!Array.isArray(manifest.queries)) fail('manifest_queries_missing');
  const expectedNames =
    mode === 'pre-identity' ? QUERY_NAMES : PRODUCT_QUERY_NAMES;
  if (
    manifest.queries
      .map((query) => query?.name)
      .sort()
      .join('\n') !== expectedNames.join('\n')
  )
    fail('manifest_query_set_mismatch');
  for (const query of manifest.queries) {
    if (
      !query ||
      typeof query.sql !== 'string' ||
      !/^\s*SELECT\b/iu.test(query.sql) ||
      /\bSELECT\s+\*/iu.test(query.sql)
    )
      fail('unsafe_query');
    if (/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/iu.test(query.sql))
      fail('mutating_query');
    if (
      !/tenant_id/iu.test(query.sql) ||
      !/workspace_id/iu.test(query.sql) ||
      !/(root_task_id|work_run_id)/iu.test(query.sql)
    )
      fail('unscoped_query');
    if (!Number.isInteger(query.row_count) || query.row_count < 0)
      fail('invalid_query_row_count');
    if (
      !Array.isArray(query.parameters) ||
      query.parameters.join('\n') !==
        [
          '$1:<redacted>',
          '$2:<redacted>',
          '$3:<redacted>',
          '$4:<redacted>',
          '$5:<redacted>',
        ].join('\n')
    )
      fail('query_parameters_not_redacted');
  }
}

export async function validateRecording(directory, mode = 'pre-identity') {
  const root = resolve(directory);
  const expected = [
    ...(mode === 'pre-identity'
      ? PRE_FILES
      : mode === 'product'
        ? PRODUCT_FILES
        : fail('invalid_mode')),
  ].sort();
  const actual = await allFiles(root);
  if (
    actual.length !== expected.length ||
    actual.some((file, index) => file !== expected[index])
  )
    fail('exact_file_set_mismatch');
  const manifest = parseJson(
    await readFile(join(root, 'manifest.json'), 'utf8'),
    'manifest.json',
  );
  if (manifest.format_version !== 'product-projection-recording/v1')
    fail('invalid_format_version');
  if (manifest.mode !== mode) fail('manifest_mode_mismatch');
  if (!SCENARIOS.has(manifest.scenario)) fail('manifest_scenario_invalid');
  if (manifest.provider_run !== 'real' || manifest.scenario_definition !== true)
    fail('recording_not_real');
  const expectedComposition = EXPECTED_MEMBER_COMPOSITIONS[manifest.scenario];
  if (
    !Array.isArray(manifest.member_composition) ||
    manifest.member_composition.some((name) => typeof name !== 'string') ||
    manifest.member_composition.join('\n') !== expectedComposition.join('\n')
  )
    fail('member_composition_invalid');
  if (manifest.submit_instruction_profile !== SUBMIT_INSTRUCTION_PROFILE)
    fail('submit_instruction_profile_invalid');
  if (!/^[0-9a-f]{64}$/u.test(manifest.definition_hash))
    fail('definition_hash_invalid');
  if (
    !manifest.provider ||
    typeof manifest.provider.kind !== 'string' ||
    typeof manifest.provider.model !== 'string' ||
    !manifest.provider.kind.trim() ||
    !manifest.provider.model.trim() ||
    /fake|scripted|stub|mock|configured|unknown/iu.test(
      `${manifest.provider.kind} ${manifest.provider.model}`,
    )
  )
    fail('provider_evidence_invalid');
  if (!manifest.service_revision || manifest.service_revision === 'unknown')
    fail('service_revision_invalid');
  if (
    manifest.scenario === 'parallel-success' &&
    manifest.predicate_evidence?.parallel_attempts_observed !== true
  )
    fail('parallel_attempt_observation_missing');
  if (
    typeof manifest.recorded_at !== 'string' ||
    Number.isNaN(Date.parse(manifest.recorded_at))
  )
    fail('invalid_recorded_at');
  if (
    typeof manifest.started_at !== 'string' ||
    Number.isNaN(Date.parse(manifest.started_at))
  )
    fail('invalid_started_at');
  if (!manifest.tenant_id || !manifest.workspace_id)
    fail('owner_scope_missing');
  assertQueries(manifest, mode);
  if (mode === 'pre-identity') {
    assertUuid(manifest.root_task_id, 'root_task_id');
    if (
      manifest.work_id?.capture_status !== 'not_applicable' ||
      manifest.work_run_id?.capture_status !== 'not_applicable'
    )
      fail('pre_identity_ids_invalid');
  } else {
    assertUuid(manifest.work_id, 'work_id');
    assertUuid(manifest.work_run_id, 'work_run_id');
  }
  const parsed = {};
  for (const file of expected.filter((name) => name.endsWith('.json'))) {
    const text = await readFile(join(root, file), 'utf8');
    parsed[file] = parseJson(text, file);
    if (stableStringify(parsed[file]) !== text) fail('noncanonical_json', file);
  }
  let secretHits = 0;
  for (const [file, value] of Object.entries(parsed)) {
    if (file === 'db/run_events.json') {
      for (const [index, row] of rows(value, file).entries()) {
        if (!row || typeof row !== 'object' || !row.payload)
          fail('invalid_run_event', `${file}[${index}]`);
        sanitizeRunEventPayload(row.payload, `${file}[${index}].payload`);
      }
    }
    try {
      sanitizeRecording(value, file, {
        allowKeys:
          file === 'db/run_events.json' ? RUN_EVENT_PAYLOAD_KEYS : undefined,
        allowExactValues:
          file === 'manifest.json'
            ? new Map([['provider_run', new Set(['real'])]])
            : undefined,
        allowProviderSummary:
          file === 'api/trace.json' || file === 'manifest.json',
      });
      assertNoEnvironmentValues(value);
    } catch (error) {
      secretHits += 1;
      throw error;
    }
  }
  const checks = parseChecksums(
    await readFile(join(root, 'SHA256SUMS'), 'utf8'),
  );
  if (checks.size !== expected.length - 1) fail('checksum_file_set_mismatch');
  let hashMismatches = 0;
  for (const file of expected.filter((name) => name !== 'SHA256SUMS')) {
    const actualHash = sha256(await readFile(join(root, file)));
    if (checks.get(file) !== actualHash) hashMismatches += 1;
    if (file !== 'manifest.json') {
      if (manifest.files?.[file]?.sha256 !== actualHash)
        fail('manifest_hash_mismatch', file);
      const expectedRows = file.startsWith('db/')
        ? rows(parsed[file], file).length
        : 1;
      if (manifest.files?.[file]?.row_count !== expectedRows)
        fail('manifest_row_count_mismatch', file);
    }
  }
  if (hashMismatches > 0) fail('hash_mismatch_count', String(hashMismatches));
  if (
    Object.keys(manifest.files ?? {})
      .sort()
      .join('\n') !==
    expected
      .filter((name) => name !== 'manifest.json' && name !== 'SHA256SUMS')
      .sort()
      .join('\n')
  )
    fail('manifest_file_set_mismatch');
  const runRows = rows(parsed['db/team_runs.json'], 'db/team_runs.json');
  if (runRows.length < 1) fail('team_run_rows_missing');
  if (
    mode === 'pre-identity' &&
    !runRows.every(
      (row) =>
        row.root_task_id === manifest.root_task_id &&
        row.tenant_id === manifest.tenant_id &&
        row.workspace_id === manifest.workspace_id &&
        row.principal_type === manifest.principal_type &&
        row.principal_id === manifest.principal_id,
    )
  )
    fail('team_run_scope_mismatch');
  if (mode === 'pre-identity') {
    const teamIds = new Set(runRows.map((row) => row.id));
    for (const file of [
      'db/team_work_items.json',
      'db/team_work_item_attempts.json',
      'db/team_messages.json',
    ]) {
      if (
        !rows(parsed[file], file).every(
          (row) =>
            teamIds.has(row.team_run_id) &&
            row.tenant_id === manifest.tenant_id &&
            row.workspace_id === manifest.workspace_id &&
            row.principal_type === manifest.principal_type &&
            row.principal_id === manifest.principal_id,
        )
      )
        fail('child_row_scope_mismatch', file);
    }
    const trace = parsed['api/trace.json'];
    if (
      trace.task?.root_task_id !== manifest.root_task_id ||
      trace.tree?.root_task_id !== manifest.root_task_id ||
      trace.project?.project?.root_task_id !== manifest.root_task_id ||
      !teamIds.has(trace.project?.project?.team_run_id)
    )
      fail('api_db_lineage_mismatch');
    for (const query of manifest.queries) {
      const file = `db/${query.name}.json`;
      if (query.row_count !== rows(parsed[file], file).length)
        fail('query_row_count_mismatch', query.name);
    }
  }
  if (mode === 'product') {
    const workRows = rows(parsed['db/works.json'], 'db/works.json');
    const workRunRows = rows(parsed['db/work_runs.json'], 'db/work_runs.json');
    const resourceRows = rows(
      parsed['db/work_run_resource_manifest.json'],
      'db/work_run_resource_manifest.json',
    );
    const workRunDocument = parsed['api/work-run.json'];
    const workRunIdentity = workRunDocument?.work_run ?? workRunDocument;
    if (
      !workRows.some(
        (row) =>
          row.id === manifest.work_id &&
          row.tenant_id === manifest.tenant_id &&
          row.workspace_id === manifest.workspace_id,
      ) ||
      !workRunRows.some(
        (row) =>
          row.id === manifest.work_run_id &&
          row.work_id === manifest.work_id &&
          row.tenant_id === manifest.tenant_id &&
          row.workspace_id === manifest.workspace_id,
      ) ||
      !resourceRows.every((row) => row.work_run_id === manifest.work_run_id) ||
      parsed['api/work.json']?.id !== manifest.work_id ||
      workRunIdentity?.id !== manifest.work_run_id ||
      workRunIdentity?.work_id !== manifest.work_id ||
      (workRunDocument?.work && workRunDocument.work.id !== manifest.work_id)
    )
      fail('product_identity_lineage_mismatch');
    for (const query of manifest.queries) {
      const file = `db/${query.name}.json`;
      if (query.row_count !== rows(parsed[file], file).length)
        fail('query_row_count_mismatch', query.name);
    }
  }
  return {
    mode,
    files: expected.length,
    api_files: actual.filter((file) => file.startsWith('api/')).length,
    db_tables: actual.filter((file) => file.startsWith('db/')).length,
    secret_hits: secretHits,
    hash_mismatches: hashMismatches,
    scenario: manifest.scenario,
  };
}

function parseChecksums(text) {
  const checks = new Map();
  for (const line of text.split(/\r?\n/u).filter(Boolean)) {
    const match = /^([0-9a-f]{64})  (.+)$/u.exec(line);
    if (!match) fail('invalid_checksum_line');
    checks.set(match[2], match[1]);
  }
  return checks;
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args[args.indexOf('--mode') + 1] ?? 'pre-identity';
  const directory =
    args.find(
      (value, index) =>
        index > 0 &&
        !value.startsWith('--') &&
        args[index - 1] !== '--mode' &&
        args[index - 1] !== '--scenario',
    ) ?? args.at(-1);
  if (!directory) fail('recording_directory_required');
  const result = await validateRecording(directory, mode);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
)
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
