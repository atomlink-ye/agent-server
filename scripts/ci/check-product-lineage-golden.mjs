#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { access, lstat, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { register as registerTsx } from 'tsx/esm/api';

registerTsx();

const root = resolve(new URL('../..', import.meta.url).pathname);
const samplePath = process.argv[2] || process.env.PRODUCT_LINEAGE_GOLDEN_OUTPUT;
const requiredDbFiles = new Set([
  'db/works.json',
  'db/work_runs.json',
  'db/team_runs.json',
  'db/team_member_runs.json',
  'db/team_work_items.json',
  'db/team_work_item_attempts.json',
  'db/team_work_item_dependencies.json',
  'db/team_messages.json',
  'db/tasks.json',
  'db/runs.json',
  'db/run_events.json',
]);

function fail(code, detail = '') {
  process.stderr.write(`${code}${detail ? `=${detail}` : ''}\n`);
  process.exitCode = code === 'missing_golden_sample' ? 2 : 1;
}
function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error(`invalid_json:${path}`);
  }
}
async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
async function regularFile(path) {
  try { return (await lstat(path)).isFile(); } catch { return false; }
}
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function frequencies(values) {
  const result = new Map();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}
function assertExactCollection(label, left, right) {
  const leftCounts = frequencies(left);
  const rightCounts = frequencies(right);
  if ([...leftCounts.values()].some((count) => count !== 1) || [...rightCounts.values()].some((count) => count !== 1))
    throw new Error(`collection_duplicate:${label}`);
  const leftKeys = [...leftCounts.keys()].sort();
  const rightKeys = [...rightCounts.keys()].sort();
  if (JSON.stringify(leftKeys) !== JSON.stringify(rightKeys))
    throw new Error(`collection_exact_set_mismatch:${label}`);
}
function flattenManifestEntries(value) {
  if (Array.isArray(value))
    return value
      .filter((entry) => isObject(entry) && typeof entry.json_pointer === 'string')
      .map((entry) => ({ key: entry.json_pointer, entry }));
  if (!isObject(value)) return [];
  const candidates = value.entries ?? value.lineage ?? value.manifest;
  if (Array.isArray(candidates)) return flattenManifestEntries(candidates);
  if (isObject(candidates)) return Object.entries(candidates).map(([key, entry]) => ({ key, entry }));
  if (Object.values(value).some((entry) => isObject(entry) && typeof entry.kind === 'string'))
    return Object.entries(value).map(([key, entry]) => ({ key, entry }));
  return [];
}
async function loadSchemas() {
  const candidates = [
    join(root, 'src/contracts/product-projection/index.ts'),
    join(root, 'src/contracts/product-projection/index.js'),
  ];
  for (const candidate of candidates) {
    if (!(await exists(candidate))) continue;
    try {
      const module = await import(pathToFileURL(candidate).href);
      return Object.entries(module).filter(
        ([name, value]) => /Schema$/u.test(name) && value && typeof value.safeParse === 'function',
      );
    } catch (error) {
      throw new Error(`schema_loader_failed:${error instanceof Error ? error.message : 'unknown'}`);
    }
  }
  throw new Error('product_projection_zod_schemas_missing');
}
function schemaForFile(file, schemas) {
  if (file === 'product-work-run.json') return schemas.find(([name]) => name === 'ProductWorkRunResponseSchema')?.[1];
  if (file === 'product-trace.json') return schemas.find(([name]) => name === 'ProductRunTraceResponseSchema')?.[1];
  const stem = file
    .replace(/\.json$/u, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, '');
  const matches = schemas.filter(([name]) => {
    const normalized = name
      .toLowerCase()
      .replace(/schema$/u, '')
      .replace(/response$/u, '')
      .replace(/[^a-z0-9]/gu, '');
    return stem.includes(normalized) || normalized.includes(stem);
  });
  if (matches.length === 1) return matches[0][1];
  const response = matches.find(([name]) => /ResponseSchema$/u.test(name));
  return response?.[1];
}
async function verifyHashes(sample, manifest) {
  const sumsPath = join(sample, 'SHA256SUMS');
  const sums = await readFile(sumsPath, 'utf8').catch(() => {
    throw new Error('sha256sums_missing');
  });
  const lines = sums.split(/\r?\n/u).filter(Boolean);
  if (!lines.length) throw new Error('sha256sums_empty');
  for (const line of lines) {
    const match = /^(?<hash>[a-f0-9]{64})  (?<path>[^\n]+)$/u.exec(line);
    if (!match) throw new Error('sha256sums_line_invalid');
    const path = match.groups.path;
    if (!(await regularFile(join(sample, path)))) throw new Error(`recording_file_not_regular:${path}`);
    if (path === 'SHA256SUMS' || path.includes('..')) throw new Error('sha256sums_path_invalid');
    const content = await readFile(join(sample, path)).catch(() => {
      throw new Error(`recording_file_missing:${path}`);
    });
    if (sha256(content) !== match.groups.hash) throw new Error(`recording_hash_mismatch:${path}`);
  }
  if (manifest.api_files?.some((file) => !lines.some((line) => line.endsWith(`  ${file}`))))
    throw new Error('manifest_api_file_not_hashed');
  if (manifest.db_files?.some((file) => !lines.some((line) => line.endsWith(`  ${file}`))))
    throw new Error('manifest_db_file_not_hashed');
  if (!isObject(manifest.file_sha256)) throw new Error('manifest_file_sha256_missing');
  const sumPaths = new Set(lines.map((line) => line.replace(/^[a-f0-9]{64}  /u, '')));
  const requiredSumPaths = new Set(['manifest.json', ...(manifest.api_files ?? []), ...(manifest.db_files ?? [])]);
  if (sumPaths.size !== requiredSumPaths.size || [...requiredSumPaths].some((path) => !sumPaths.has(path)))
    throw new Error('sha256sums_file_set_invalid');
  const expectedFiles = new Set(['manifest.json', 'SHA256SUMS', ...(manifest.api_files ?? []), ...(manifest.db_files ?? [])]);
  const listedFiles = new Set(Object.keys(manifest.file_sha256));
  for (const file of [...expectedFiles].filter((file) => file !== 'manifest.json' && file !== 'SHA256SUMS'))
    if (!listedFiles.has(file)) throw new Error(`manifest_file_sha256_missing:${file}`);
  if (listedFiles.size !== expectedFiles.size - 2 || [...listedFiles].some((file) => !expectedFiles.has(file)))
    throw new Error('manifest_file_sha256_file_set_invalid');
  for (const [path, expected] of Object.entries(manifest.file_sha256)) {
    if (!/^[a-f0-9]{64}$/u.test(expected) || path === 'manifest.json')
      throw new Error('manifest_file_sha256_invalid');
    const content = await readFile(join(sample, path)).catch(() => {
      throw new Error(`manifest_file_missing:${path}`);
    });
    if (sha256(content) !== expected) throw new Error(`manifest_file_hash_mismatch:${path}`);
  }
}
async function main() {
  if (!samplePath || !(await exists(samplePath))) {
    fail('missing_golden_sample', samplePath || '<unset>');
    return;
  }
  const sample = resolve(samplePath);
  let manifest;
  try {
    manifest = await readJson(join(sample, 'manifest.json'));
    if (!isObject(manifest) || manifest.format_version !== 'product-lineage-golden-v1')
      throw new Error('manifest_format_invalid');
    if (
      manifest.provider_run !== 'real' ||
      typeof manifest.service_revision !== 'string' ||
      !/^[0-9a-f]{7,40}$/u.test(manifest.service_revision)
    )
      throw new Error('manifest_provider_or_revision_invalid');
    if (
      !isObject(manifest.provider_evidence) ||
      typeof manifest.provider_evidence.provider !== 'string' ||
      !manifest.provider_evidence.provider ||
      typeof manifest.provider_evidence.model !== 'string' ||
      !manifest.provider_evidence.model ||
      !/^[0-9a-f]{64}$/u.test(
        manifest.provider_evidence.root_run_sha256 ?? '',
      ) ||
      !/^[0-9a-f]{64}$/u.test(
        manifest.provider_evidence.provider_run_sha256 ?? '',
      )
    )
      throw new Error('manifest_provider_evidence_invalid');
    if (!isObject(manifest.ids) || !manifest.ids.work_id || !manifest.ids.work_run_id || !manifest.ids.root_task_id || !manifest.ids.team_run_id)
      throw new Error('manifest_ids_invalid');
    if (!isObject(manifest.correlation)) throw new Error('manifest_correlation_invalid');
    if (!Array.isArray(manifest.api_files) || !Array.isArray(manifest.db_files))
      throw new Error('manifest_files_invalid');
    const requiredApiFiles = ['api/product-work-run.json', 'api/product-trace.json'];
    if (manifest.api_files.length !== requiredApiFiles.length ||
      new Set(manifest.api_files).size !== requiredApiFiles.length ||
      requiredApiFiles.some((file) => !manifest.api_files.includes(file)))
      throw new Error('manifest_required_api_files_invalid');
    if (manifest.db_files.length !== requiredDbFiles.size || manifest.db_files.some((file) => !requiredDbFiles.has(file)))
      throw new Error('manifest_required_db_files_invalid');
    const top = await readdir(sample, { withFileTypes: true });
    if (top.some((entry) => !['api', 'db', 'manifest.json', 'SHA256SUMS'].includes(entry.name) || ((entry.name === 'api' || entry.name === 'db') && !entry.isDirectory()))) throw new Error('recording_extra_entry');
    for (const directory of ['api', 'db']) {
      const entries = await readdir(join(sample, directory), { withFileTypes: true }).catch(() => { throw new Error(`recording_directory_missing:${directory}`); });
      const expected = (directory === 'api' ? manifest.api_files : manifest.db_files).map((file) => file.slice(directory.length + 1));
      if (entries.some((entry) => !entry.isFile() || !expected.includes(entry.name)) || entries.length !== expected.length)
      throw new Error(`recording_extra_or_missing_files:${directory}`);
    }
    if (!(await regularFile(join(sample, 'manifest.json'))) || !(await regularFile(join(sample, 'SHA256SUMS'))))
      throw new Error('recording_manifest_or_sums_not_regular');
    await verifyHashes(sample, manifest);
    const schemas = await loadSchemas();
    if (!schemas.length) throw new Error('product_projection_zod_schemas_empty');
    let apiCount = 0;
    const apiRecords = [];
    for (const file of manifest.api_files) {
      if (!/^api\/[^/]+\.json$/u.test(file)) throw new Error('manifest_api_path_invalid');
      const value = await readJson(join(sample, file));
      const schema = schemaForFile(file.split('/').pop(), schemas);
      if (!schema) throw new Error(`api_schema_unresolved:${file}`);
      const parsed = schema.safeParse(value);
      if (!parsed.success) throw new Error(`api_schema_invalid:${file}`);
      apiRecords.push({
        file,
        value,
        owner: file === 'api/product-work-run.json' ? 'work_run_response' : 'run_trace_response',
      });
      apiCount += 1;
    }
    let dbCount = 0;
    for (const file of manifest.db_files) {
      if (!/^db\/[^/]+\.json$/u.test(file)) throw new Error('manifest_db_path_invalid');
      const rows = await readJson(join(sample, file));
      if (!Array.isArray(rows)) throw new Error(`db_rows_not_array:${file}`);
      if (file === 'db/team_work_item_attempts.json' && rows.some((row) => Object.hasOwn(row, 'feedback') || Object.hasOwn(row, 'result_summary')))
        throw new Error('db_attempt_text_not_sanitized');
      if (file === 'db/team_messages.json' && rows.some((row) => Object.hasOwn(row, 'body')))
        throw new Error('db_message_body_not_sanitized');
      if (file === 'db/run_events.json' && rows.some((row) => Object.hasOwn(row, 'payload')))
        throw new Error('db_event_payload_not_sanitized');
      dbCount += rows.length;
    }
    if (!isObject(manifest.query_row_counts)) throw new Error('manifest_query_row_counts_missing');
    const expectedQueryTables = [...requiredDbFiles].map((file) => file.slice(3, -5));
    const queryCountKeys = Object.keys(manifest.query_row_counts);
    if (queryCountKeys.length !== expectedQueryTables.length ||
      expectedQueryTables.some((table) => !Object.hasOwn(manifest.query_row_counts, table)) ||
      queryCountKeys.some((table) => !expectedQueryTables.includes(table)))
      throw new Error('manifest_query_row_counts_file_set_invalid');
    for (const table of expectedQueryTables) {
      const count = manifest.query_row_counts[table];
      if (!Number.isInteger(count) || count < 0 || count !== (await readJson(join(sample, `db/${table}.json`))).length)
        throw new Error(`query_row_count_mismatch:${table}`);
    }
    const lineageCandidates = [
      join(root, 'src/contracts/product-projection/lineage-manifest.ts'),
      join(root, 'src/application/product-projection/lineage/product-lineage-manifest.ts'),
    ];
    let lineageModule;
    for (const candidate of lineageCandidates) {
      if (await exists(candidate)) {
        lineageModule = candidate;
        break;
      }
    }
    if (!lineageModule) throw new Error('lineage_manifest_missing');
    const lineage = await import(pathToFileURL(lineageModule).href);
    let entries = flattenManifestEntries(lineage.default ?? lineage);
    if (!entries.length)
      for (const value of Object.values(lineage)) {
        entries = flattenManifestEntries(value);
        if (entries.length) break;
      }
    if (!entries.length) throw new Error('lineage_manifest_entries_missing');
    const applicable = entries.filter(({ key }) => String(key).includes('.success::'));
    const source = applicable.filter(({ entry }) => entry?.source_kind === 'column' || entry?.source_kind === 'source_ref' || entry?.kind === 'column' || entry?.kind === 'source_ref');
    const derived = applicable.filter(({ entry }) => (entry?.source_kind === 'derivation' && entry?.derivation_id) || (entry?.kind === 'derivation' && entry?.name));
    if (!source.length || !derived.length) throw new Error('lineage_manifest_sampling_classes_missing');
    const seed = sha256(await readFile(join(sample, 'SHA256SUMS')));
    const dbByTable = new Map();
    for (const file of manifest.db_files)
      dbByTable.set(file.slice(3, -5), await readJson(join(sample, file)));
    const normalize = (value) => value instanceof Date ? value.toISOString() : value;
    const equal = (left, right) => JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
    const responseFor = (key) => {
      const owner = String(key).split('::', 1)[0].split('.')[0];
      return apiRecords.find((record) => record.owner === owner);
    };
    const relative = (key) => String(key).replace(/^.*::/u, '').replace(/^\//u, '');
    const walkOccurrences = (value, path) => {
      const segments = String(path).split('.').filter(Boolean);
      const visit = (current, index, objects) => {
        if (index === segments.length) return [{ value: current, objects }];
        if (current === null || current === undefined) return [];
        const segment = segments[index];
        const edge = /^([^\[{]+)\[\]\{kind=([^}]+)\}$/u.exec(segment);
        const array = /^([^\[{]+)\[\]$/u.exec(segment);
        if (edge) {
          const values = Array.isArray(current[edge[1]]) ? current[edge[1]].filter((item) => item?.kind === edge[2]) : [];
          return values.flatMap((item) => visit(item, index + 1, [...objects, current]));
        }
        if (array) {
          const values = Array.isArray(current[array[1]]) ? current[array[1]] : [];
          return values.flatMap((item) => visit(item, index + 1, [...objects, current]));
        }
        return visit(current[segment], index + 1, [...objects, current]);
      };
      return visit(value, 0, []);
    };
    const occurrencesFor = (key) => {
      const record = responseFor(key);
      return record ? walkOccurrences(record.value, relative(key)) : [];
    };
    const latestObject = (objects, predicate) => [...objects].reverse().find((item) => isObject(item) && predicate(item));
    const sourceRowFor = (table, occurrence, record) => {
      const objects = occurrence.objects;
      const work = latestObject(objects, (item) => Object.hasOwn(item, 'work_run') && Object.hasOwn(item, 'work'));
      const workRun = latestObject(objects, (item) => Object.hasOwn(item, 'work_id') && Object.hasOwn(item, 'trigger_kind'));
      const item = latestObject(objects, (item) => Array.isArray(item.attempts) && Object.hasOwn(item, 'dependency_ids'));
      const attempt = latestObject(objects, (item) => Object.hasOwn(item, 'attempt_no') && Object.hasOwn(item, 'feedback_capture_status'));
      const actor = latestObject(objects, (item) => Object.hasOwn(item, 'name') && Object.hasOwn(item, 'source_refs'));
      const message = latestObject(objects, (item) => Object.hasOwn(item, 'summary_capture_status') && Object.hasOwn(item, 'sender_id'));
      const run = latestObject(objects, (item) => Object.hasOwn(item, 'result_capture_status') && Object.hasOwn(item, 'source_refs'));
      const event = latestObject(objects, (item) => Object.hasOwn(item, 'payload_capture_status') && Object.hasOwn(item, 'sequence'));
      const edge = latestObject(objects, (item) => typeof item.kind === 'string' && Object.hasOwn(item, 'source_refs'));
      const refs = (object) => object?.source_refs ?? {};
      const rows = dbByTable.get(table) ?? [];
      return rows.find((row) => {
        if (table === 'works') return row.id === (record.value.work?.id ?? manifest.ids.work_id);
        if (table === 'work_runs') return row.id === (record.value.work_run?.id ?? manifest.ids.work_run_id);
        if (table === 'team_work_items') return row.id === item?.id && (!row.team_run_id || row.team_run_id === refs(item).team_run_id);
        if (table === 'team_work_item_attempts') return row.id === attempt?.id && (!row.team_run_id || row.team_run_id === refs(attempt).team_run_id);
        if (table === 'team_member_runs') return row.id === actor?.id && (!row.team_run_id || row.team_run_id === refs(actor).team_run_id);
        if (table === 'team_messages') return row.id === (message?.id ?? edge?.message_id) && (!row.team_run_id || row.team_run_id === refs(message ?? edge).team_run_id);
        if (table === 'runs') return row.id === refs(run).run_id;
        if (table === 'run_events') return row.run_id === refs(event).run_id && row.sequence === event?.sequence;
        if (table === 'team_work_item_dependencies') return row.team_run_id === refs(edge).team_run_id && row.work_item_id === (edge?.dependent_work_item_id ?? edge?.work_item_id) && row.depends_on_work_item_id === (edge?.prerequisite_work_item_id ?? edge?.dependency_id);
        if (table === 'tasks') return row.id === refs(edge).task_id;
        return false;
      });
    };
    const dbValues = (table, column) => (dbByTable.get(table) ?? []).map((row) => normalize(row[column]));
    const responseByOwner = (owner) => apiRecords.find((record) => record.owner === owner)?.value;
    for (const record of apiRecords) {
      const prefix = record.owner === 'work_run_response' ? 'work' : 'trace';
      assertExactCollection(`${prefix}.work.id`, [record.value.work?.id].filter((value) => value !== undefined), dbValues('works', 'id'));
      assertExactCollection(`${prefix}.work_run.id`, [record.value.work_run?.id].filter((value) => value !== undefined), dbValues('work_runs', 'id'));
      assertExactCollection(`${prefix}.work_items.id`, (record.value.work_items ?? []).map((item) => item.id), dbValues('team_work_items', 'id'));
      assertExactCollection(`${prefix}.attempts.id`, (record.value.work_items ?? []).flatMap((item) => item.attempts.map((attempt) => attempt.id)), dbValues('team_work_item_attempts', 'id'));
      assertExactCollection(`${prefix}.actors.id`, (record.value.actors ?? []).map((actor) => actor.id), dbValues('team_member_runs', 'id'));
      assertExactCollection(`${prefix}.messages.id`, (record.value.messages ?? []).map((message) => message.id), dbValues('team_messages', 'id'));
    }
    const trace = responseByOwner('run_trace_response');
    if (!trace) throw new Error('trace_response_missing');
    assertExactCollection('trace.runs.id', (trace.runs ?? []).map((run) => run.source_refs?.run_id), dbValues('runs', 'id'));
    assertExactCollection('trace.events.run_id_sequence', (trace.events ?? []).map((event) => JSON.stringify([event.source_refs?.run_id, event.sequence])), (dbByTable.get('run_events') ?? []).map((row) => JSON.stringify([row.run_id, row.sequence])));
    const taskById = new Map((dbByTable.get('tasks') ?? []).map((row) => [row.id, row]));
    const edgeTuple = (kind, edge) => {
      if (kind === 'observed_message') return [edge.source_refs?.team_run_id, edge.message_id, edge.sequence, edge.sender_actor_id, edge.recipient_actor_id, edge.work_item_id, edge.attempt_id, edge.source_created_at];
      if (kind === 'declared_dependency') return [edge.source_refs?.team_run_id, edge.dependent_work_item_id, edge.prerequisite_work_item_id, edge.source_created_at];
      if (kind === 'assignment') return [edge.source_refs?.team_run_id, edge.source_refs?.task_id, edge.attempt_id, edge.work_item_id, edge.assignee_actor_id, edge.source_created_at];
      return [edge.source_refs?.team_run_id, edge.source_refs?.task_id, edge.attempt_id, edge.work_item_id, edge.reviewer_actor_id, edge.source_created_at];
    };
    const dbEdgeTuple = (kind, row) => {
      if (kind === 'observed_message') return [row.team_run_id, row.id, row.sequence, row.sender_member_run_id, row.recipient_member_run_id, row.work_item_id, row.attempt_id, row.created_at];
      if (kind === 'declared_dependency') return [row.team_run_id, row.work_item_id, row.depends_on_work_item_id, row.created_at];
      const reviewer = taskById.get(row.requested_by_lead_task_id)?.team_member_run_id ?? null;
      return [row.team_run_id, row.requested_by_lead_task_id, row.id, row.work_item_id, kind === 'feedback' ? reviewer : row.assignee_member_id, row.created_at];
    };
    for (const kind of ['assignment', 'declared_dependency', 'feedback', 'observed_message']) {
      const responseEdges = (trace.edges ?? []).filter((edge) => edge.kind === kind);
      const sourceRows = (dbByTable.get(kind === 'observed_message' ? 'team_messages' : kind === 'declared_dependency' ? 'team_work_item_dependencies' : 'team_work_item_attempts') ?? []).filter((row) => kind !== 'feedback' || row.feedback_present === true);
      assertExactCollection(`trace.edges.${kind}`, responseEdges.map((edge) => JSON.stringify(edgeTuple(kind, edge))), sourceRows.map((row) => JSON.stringify(dbEdgeTuple(kind, row))));
    }
    const supportedFormula = (formula) => typeof formula === 'string' && (/^constant\(/u.test(formula) || /capture_to_null/u.test(formula) || /presence_to_redaction_status/u.test(formula) || /capture_status\(redacted_or_absent\)/u.test(formula) || /collect\(depends_on_work_item_id\)/u.test(formula) || /json_extract\(/u.test(formula));
    const sourceApplicable = source.filter(({ key, entry }) => {
      const occurrence = occurrencesFor(key)[0];
      return occurrence && occurrence.value !== undefined && sourceRowFor(entry.table ?? String(entry.source ?? '').split('.')[0], occurrence, responseFor(key));
    });
    const derivedApplicable = derived.filter(({ entry }) => supportedFormula(entry.formula));
    if (!sourceApplicable.length) throw new Error('golden_source_occurrences_empty');
    if (!derivedApplicable.length) throw new Error('golden_derived_occurrences_empty');
    const formulaFamily = (formula) => /collect\(/u.test(formula) ? 'collect' : /presence_to_redaction_status|capture_status\(redacted_or_absent\)/u.test(formula) ? 'presence' : /json_extract\(/u.test(formula) ? 'json_extract' : /capture_to_null/u.test(formula) ? 'null' : 'constant';
    const sampleEntries = (list, count, ensureFamilies = false) => {
      const start = Number.parseInt(seed.slice(0, 8), 16) % list.length;
      const ordered = [...list.slice(start), ...list.slice(0, start)];
      if (ensureFamilies) {
        const chosen = [];
        for (const family of ['presence', 'collect', 'json_extract', 'null', 'constant']) {
          const candidate = ordered.find((item) => formulaFamily(item.entry.formula) === family);
          if (candidate) chosen.push(candidate);
        }
        return [...chosen, ...ordered.filter((item) => !chosen.includes(item))].slice(0, Math.min(count, list.length));
      }
      return ordered.slice(0, Math.min(count, list.length));
    };
    const sourceSamples = sampleEntries(sourceApplicable, Math.min(3, sourceApplicable.length));
    let mismatches = 0;
    for (const { key, entry } of sourceSamples) {
      const table = entry.table ?? String(entry.source ?? '').split('.')[0];
      const column = entry.column ?? String(entry.source ?? '').split('.').slice(1).join('.');
      const occurrence = occurrencesFor(key)[0];
      const record = responseFor(key);
      const row = occurrence && record ? sourceRowFor(table, occurrence, record) : undefined;
      if (!row || !column || occurrence.value === undefined || !equal(row[column], occurrence.value)) mismatches += 1;
    }
    const derivedCandidates = [];
    const presenceAlias = new Map([
      ['team_work_item_attempts.feedback', 'feedback_present'],
      ['team_work_item_attempts.result_summary', 'result_present'],
      ['team_messages.body', 'body_present'],
      ['runs.result', 'result_present'],
      ['run_events.payload', 'payload_present'],
    ]);
    for (const { key, entry } of derivedApplicable) {
      const formula = entry.formula;
      const record = responseFor(key);
      if (!record) continue;
      if (/collect\(depends_on_work_item_id\)/u.test(formula)) {
        for (const item of record.value.work_items ?? []) {
          const expected = (dbByTable.get('team_work_item_dependencies') ?? [])
            .filter((row) => row.work_item_id === item.id)
            .map((row) => row.depends_on_work_item_id);
          derivedCandidates.push({
            key,
            entry,
            actual: [...item.dependency_ids].sort(),
            expected: expected.sort(),
          });
        }
        continue;
      }
      for (const occurrence of occurrencesFor(key)) {
        let expected;
        const constant = /^constant\((.*)\)$/u.exec(formula);
        if (constant)
          expected = constant[1] === 'empty_collection' ? [] : constant[1];
        else if (/capture_to_null/u.test(formula)) expected = null;
        else if (/presence_to_redaction_status|capture_status\(redacted_or_absent\)/u.test(formula)) {
          const input = entry.inputs?.[0];
          const [table] = String(input ?? '').split('.');
          const alias = presenceAlias.get(input);
          const row = alias ? sourceRowFor(table, occurrence, record) : undefined;
          if (row) expected = row[alias] === true ? 'redacted' : 'not_present';
        } else if (/json_extract\(/u.test(formula)) {
          const input = entry.inputs?.[0];
          const [table] = String(input ?? '').split('.');
          const row = sourceRowFor(table, occurrence, record);
          const jsonField = /'\$\.([^']+)'/u.exec(formula)?.[1];
          if (row && jsonField) expected = row[jsonField === 'code' ? 'error_code' : jsonField] ?? null;
        }
        if (expected !== undefined)
          derivedCandidates.push({ key, entry, actual: occurrence.value, expected });
      }
    }
    if (!derivedCandidates.length) throw new Error('golden_derived_occurrences_empty');
    const derivedSamples = sampleEntries(derivedCandidates, Math.min(8, derivedCandidates.length), true);
    for (const sample of derivedSamples)
      if (!equal(sample.expected, sample.actual)) mismatches += 1;
    if (!sourceSamples.length || !derivedSamples.length) throw new Error('golden_samples_empty');
    if (mismatches) throw new Error(`lineage_sample_mismatches:${mismatches}`);
    process.stdout.write(`source_samples=${sourceSamples.length} derived_samples=${derivedSamples.length} mismatches=${mismatches} seed=${seed}\n`);
    process.stdout.write(`api_files=${apiCount} db_rows=${dbCount}\n`);
  } catch (error) {
    fail('golden_invalid', error instanceof Error ? error.message : 'unknown');
  }
}
await main();
