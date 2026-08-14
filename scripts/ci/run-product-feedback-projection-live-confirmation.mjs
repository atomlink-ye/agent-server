#!/usr/bin/env node

/*
 * C-owned live confirmation arm.  This file intentionally has no bundle,
 * manifest, sidecar, or candidate-sha input.  The only recording it trusts is
 * the fresh directory returned by captureProductRun in this invocation.
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { isAbsolute, join, relative, resolve } from 'node:path';
import pg from 'pg';

import {
  ProductRunTraceResponseSchema,
  ProductWorkResponseSchema,
  ProductWorkRunResponseSchema,
} from '@atomlink-ye/agent-server/product-contract';
import { validateRecording } from './validate-product-recording.mjs';
import {
  captureProductRun,
  SUBMIT_INSTRUCTION_PROFILE,
} from '../record/lib/capture-product-run.mjs';

export const LIVE_ARM = 'FEEDBACK_PROJECTION_LIVE_UNBLOCK_CONFIRMATION';
export const KNOWN_LIVE_BLOCKER = `${LIVE_ARM}_KNOWN_LIVE_BLOCKER`;
export const UNBLOCKED_CANDIDATE = 'UNBLOCKED_CANDIDATE';
export const MISSING = 'MISSING';

const EXIT_CODES = Object.freeze({
  [UNBLOCKED_CANDIDATE]: 0,
  [KNOWN_LIVE_BLOCKER]: 1,
  [MISSING]: 2,
});
const SCENARIO = 'rework-once';
const FULL_SHA = /^[0-9a-f]{40}$/iu;
const FULL_HASH = /^[0-9a-f]{64}$/iu;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const execFile = promisify(execFileCallback);
const { Client } = pg;

const REQUIRED_ENV = Object.freeze([
  'C4_LIVE_REMOTE_WORKSPACE_ROOT',
  'C4_LIVE_BASE_URL',
  'C4_LIVE_TOKEN',
  'C4_LIVE_DATABASE_URL',
  'C4_LIVE_ROOT_TASK_ID',
  'C4_LIVE_WORK_ID',
  'C4_LIVE_WORK_RUN_ID',
  'C4_LIVE_TENANT_ID',
  'C4_LIVE_WORKSPACE_ID',
  'C4_LIVE_PRINCIPAL_ID',
  'C4_LIVE_PROVIDER_KIND',
  'C4_LIVE_DEFINITION_HASH',
  'C4_LIVE_OUTPUT_ROOT',
  'C4_LIVE_EVIDENCE_ROOT',
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

class MissingInput extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'MissingInput';
    this.reason = reason;
  }
}

function object(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new MissingInput(`${name}_shape_unverifiable`);
  return value;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new MissingInput(`live_env_${name}_missing`);
  return value;
}

function uuid(value, name) {
  if (!UUID.test(value)) throw new MissingInput(`${name}_invalid`);
  return value;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function schemaIssues(result) {
  if (result.success || !result.error) return [];
  return result.error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || '<root>'}:${issue.message}`);
}

function parseJson(bytes, name) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new MissingInput(`${name}_json_invalid`);
  }
}

async function readCandidateSha(remoteWorkspaceRoot) {
  if (!isAbsolute(remoteWorkspaceRoot))
    throw new MissingInput('remote_workspace_root_must_be_absolute');
  let stdout;
  try {
    ({ stdout } = await execFile(
      'git',
      ['-C', remoteWorkspaceRoot, 'rev-parse', 'HEAD'],
      {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      },
    ));
  } catch {
    throw new MissingInput('remote_workspace_head_unreadable');
  }
  const candidateSha = stdout.trim();
  if (!FULL_SHA.test(candidateSha))
    throw new MissingInput('remote_workspace_head_invalid');
  return candidateSha;
}

async function getAcceptedJson(baseUrl, token, path, name) {
  let response;
  try {
    response = await fetch(new URL(path, baseUrl), {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
  } catch {
    throw new MissingInput(`${name}_service_unreachable`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new MissingInput(`${name}_http_${response.status}`);
  return parseJson(bytes, name);
}

async function readServiceRevision(baseUrl, token) {
  let response;
  try {
    response = await fetch(new URL('/health/live', baseUrl), {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
  } catch {
    throw new MissingInput('service_revision_unreachable');
  }
  if (!response.ok)
    throw new MissingInput(`service_revision_http_${response.status}`);
  const body = parseJson(
    Buffer.from(await response.arrayBuffer()),
    'service_revision',
  );
  const candidates = [
    response.headers.get('x-service-revision'),
    response.headers.get('x-git-sha'),
    body?.version,
  ].filter((value) => typeof value === 'string' && FULL_SHA.test(value.trim()));
  const revisions = [...new Set(candidates.map((value) => value.trim()))];
  if (revisions.length !== 1)
    throw new MissingInput('service_revision_unverifiable');
  return revisions[0];
}

async function assertExistingWorkRun(client, input) {
  let result;
  try {
    result = await client.query(
      `SELECT wr.id,wr.work_id,wr.root_task_id,wr.tenant_id,wr.workspace_id
         FROM work_runs wr
         JOIN works w ON w.id=wr.work_id
         JOIN tasks t ON t.id=wr.root_task_id
        WHERE wr.id=$1 AND wr.work_id=$2 AND wr.root_task_id=$3
          AND wr.tenant_id=$4 AND wr.workspace_id=$5
          AND w.tenant_id=$4 AND w.workspace_id=$5
          AND t.tenant_id=$4 AND t.workspace_id=$5::text
          AND t.principal_type=$6 AND t.principal_id=$7`,
      [
        input.workRunId,
        input.workId,
        input.rootTaskId,
        input.tenantId,
        input.workspaceId,
        input.principalType,
        input.principalId,
      ],
    );
  } catch {
    throw new MissingInput('live_db_work_run_query_failed');
  }
  if (result.rowCount !== 1)
    throw new MissingInput('live_db_work_run_scope_missing_or_non_unique');
  const row = result.rows[0];
  if (
    row.id !== input.workRunId ||
    row.work_id !== input.workId ||
    row.root_task_id !== input.rootTaskId
  )
    throw new MissingInput('live_db_work_run_identity_mismatch');
}

async function allFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...(await allFiles(root, path)));
    else files.push(relative(root, path));
  }
  return files.sort();
}

async function recomputeBundleHashes(directory) {
  const actual = await allFiles(directory);
  if (actual.join('\n') !== [...PRODUCT_FILES].sort().join('\n'))
    throw new MissingInput('fresh_bundle_file_set_mismatch');
  const manifestBytes = await readFile(join(directory, 'manifest.json'));
  const manifest = object(parseJson(manifestBytes, 'manifest'), 'manifest');
  const checksumText = (
    await readFile(join(directory, 'SHA256SUMS'), 'utf8')
  ).trimEnd();
  const checksums = new Map();
  for (const line of checksumText.split('\n')) {
    const match = /^([0-9a-f]{64})  (.+)$/u.exec(line);
    if (!match) throw new MissingInput('fresh_checksum_line_invalid');
    checksums.set(match[2], match[1]);
  }
  const expectedChecksumFiles = PRODUCT_FILES.filter(
    (file) => file !== 'SHA256SUMS',
  );
  if (
    checksums.size !== expectedChecksumFiles.length ||
    expectedChecksumFiles.some((file) => !checksums.has(file))
  )
    throw new MissingInput('fresh_checksum_file_set_mismatch');
  for (const file of expectedChecksumFiles) {
    const bytes = await readFile(join(directory, file));
    const actualHash = sha256(bytes);
    if (checksums.get(file) !== actualHash)
      throw new MissingInput(`fresh_checksum_mismatch:${file}`);
    if (
      file !== 'manifest.json' &&
      manifest.files?.[file]?.sha256 !== actualHash
    )
      throw new MissingInput(`fresh_manifest_hash_mismatch:${file}`);
  }
  return { manifest, manifestSha256: sha256(manifestBytes) };
}

function captureAttemptRows(bundle) {
  return bundle['db/team_work_item_attempts.json'];
}

export function evaluateFreshBundle(
  bundle,
  candidateSha,
  serviceRevision,
  startMs,
  endMs,
  input,
) {
  const { manifest, manifestSha256 } = bundle;
  if (
    manifest.format_version !== 'product-projection-recording/v1' ||
    manifest.mode !== 'product' ||
    manifest.provider_run !== 'real'
  )
    throw new MissingInput('fresh_manifest_capture_identity_invalid');
  if (
    manifest.scenario !== SCENARIO ||
    manifest.root_task_id !== input.rootTaskId ||
    manifest.work_id !== input.workId ||
    manifest.work_run_id !== input.workRunId
  )
    throw new MissingInput('fresh_manifest_identity_mismatch');
  if (
    manifest.git_sha !== candidateSha ||
    manifest.service_revision !== serviceRevision ||
    serviceRevision !== candidateSha
  )
    throw new MissingInput('fresh_manifest_candidate_binding_mismatch');
  if (!FULL_SHA.test(manifest.git_sha))
    throw new MissingInput('fresh_manifest_candidate_sha_invalid');
  const recordedAt = Date.parse(manifest.recorded_at);
  if (
    !Number.isFinite(recordedAt) ||
    recordedAt < startMs ||
    recordedAt > endMs
  )
    throw new MissingInput('fresh_recorded_at_outside_runner_window');
  if (
    manifest.tenant_id !== input.tenantId ||
    manifest.workspace_id !== input.workspaceId
  )
    throw new MissingInput('fresh_manifest_scope_mismatch');

  const workRunResult = ProductWorkRunResponseSchema.safeParse(
    bundle['api/work-run.json'],
  );
  if (!workRunResult.success)
    throw new MissingInput(
      `fresh_work_run_schema_invalid:${schemaIssues(workRunResult).join('|')}`,
    );
  const traceResult = ProductRunTraceResponseSchema.safeParse(
    bundle['api/trace.json'],
  );
  if (!traceResult.success)
    throw new MissingInput(
      `fresh_trace_schema_invalid:${schemaIssues(traceResult).join('|')}`,
    );
  const workRun = workRunResult.data;
  const trace = traceResult.data;
  if (
    workRun.projection_status !== 'internally_anchored' ||
    trace.projection_status !== 'internally_anchored'
  )
    throw new MissingInput('fresh_projection_not_anchored');
  if (
    workRun.work.id !== input.workId ||
    workRun.work_run.id !== input.workRunId ||
    workRun.work_run.work_id !== input.workId
  )
    throw new MissingInput('fresh_api_work_run_identity_mismatch');
  if (
    trace.work.id !== input.workId ||
    trace.work_run.id !== input.workRunId ||
    trace.work_run.work_id !== input.workId
  )
    throw new MissingInput('fresh_api_trace_identity_mismatch');

  const teamRuns = bundle['db/team_runs.json'];
  const attempts = captureAttemptRows(bundle);
  if (!Array.isArray(teamRuns) || !Array.isArray(attempts))
    throw new MissingInput('fresh_db_rows_shape_unverifiable');
  const teamRunIds = new Set(
    teamRuns
      .filter(
        (row) =>
          row &&
          typeof row === 'object' &&
          row.root_task_id === input.rootTaskId &&
          row.tenant_id === input.tenantId &&
          row.workspace_id === input.workspaceId,
      )
      .map((row) => row.id),
  );
  if (teamRunIds.size < 1)
    throw new MissingInput('fresh_db_root_scope_missing');
  const feedbackRows = attempts.filter(
    (row) =>
      row &&
      typeof row === 'object' &&
      teamRunIds.has(row.team_run_id) &&
      typeof row.feedback === 'string' &&
      Buffer.from(row.feedback, 'utf8').length > 0,
  );
  if (feedbackRows.length !== 1)
    throw new MissingInput('fresh_db_feedback_nonempty_not_exactly_one');
  const dbAttempt = feedbackRows[0];
  if (
    !UUID.test(dbAttempt.id) ||
    !teamRunIds.has(dbAttempt.team_run_id) ||
    !UUID.test(dbAttempt.work_item_id ?? '')
  )
    throw new MissingInput('fresh_db_attempt_identity_invalid');
  const apiAttempts = workRun.work_items.flatMap((item) => item.attempts);
  const sameAttempts = apiAttempts.filter(
    (attempt) => attempt.id === dbAttempt.id,
  );
  if (sameAttempts.length !== 1)
    throw new MissingInput('fresh_api_db_attempt_join_invalid');
  const apiAttempt = sameAttempts[0];
  if (
    apiAttempt.source_refs.root_task_id !== input.rootTaskId ||
    apiAttempt.source_refs.team_run_id !== dbAttempt.team_run_id
  )
    throw new MissingInput('fresh_api_db_attempt_scope_mismatch');

  const apiWorkItems = workRun.work_items.filter((item) =>
    item.attempts.some((attempt) => attempt.id === dbAttempt.id),
  );
  const traceAttempts = trace.work_items.flatMap((item) => item.attempts);
  const traceSameAttempts = traceAttempts.filter(
    (attempt) => attempt.id === dbAttempt.id,
  );
  const traceWorkItems = trace.work_items.filter((item) =>
    item.attempts.some((attempt) => attempt.id === dbAttempt.id),
  );
  if (
    apiWorkItems.length !== 1 ||
    traceWorkItems.length !== 1 ||
    traceSameAttempts.length !== 1
  )
    throw new MissingInput('fresh_trace_api_attempt_join_invalid');
  const apiWorkItem = apiWorkItems[0];
  const traceWorkItem = traceWorkItems[0];
  if (
    traceWorkItem.id !== apiWorkItem.id ||
    dbAttempt.work_item_id !== apiWorkItem.id
  )
    throw new MissingInput('fresh_db_api_work_item_join_invalid');
  const traceAttempt = traceSameAttempts[0];
  const sourceRefKeys = [
    'root_task_id',
    'team_run_id',
    'team_member_run_id',
    'task_id',
    'run_id',
  ];
  if (
    sourceRefKeys.some(
      (key) => apiAttempt.source_refs[key] !== traceAttempt.source_refs[key],
    )
  )
    throw new MissingInput('fresh_api_trace_attempt_source_refs_mismatch');
  if (
    apiAttempt.feedback_capture_status !== traceAttempt.feedback_capture_status
  )
    throw new MissingInput('fresh_api_trace_feedback_status_mismatch');
  if (
    (apiAttempt.feedback_summary === null) !==
      (traceAttempt.feedback_summary === null) ||
    (typeof apiAttempt.feedback_summary === 'string' &&
      typeof traceAttempt.feedback_summary === 'string' &&
      !Buffer.from(apiAttempt.feedback_summary, 'utf8').equals(
        Buffer.from(traceAttempt.feedback_summary, 'utf8'),
      ))
  )
    throw new MissingInput('fresh_api_trace_feedback_value_mismatch');
  const feedbackEdges = trace.edges.filter(
    (edge) => edge.kind === 'feedback' && edge.attempt_id === dbAttempt.id,
  );
  if (
    feedbackEdges.length !== 1 ||
    feedbackEdges[0].work_item_id !== apiWorkItem.id ||
    feedbackEdges[0].source_refs.team_run_id !== dbAttempt.team_run_id ||
    (dbAttempt.requested_by_lead_task_id &&
      feedbackEdges[0].source_refs.task_id !==
        dbAttempt.requested_by_lead_task_id)
  )
    throw new MissingInput('fresh_trace_feedback_edge_join_invalid');

  const common = {
    arm: LIVE_ARM,
    assertion:
      'fresh exact DB feedback is joined to the same accepted API attempt after a same-window capture',
    candidate_sha: candidateSha,
    recorded_at: manifest.recorded_at,
    manifest_sha256: manifestSha256,
    attempt_id: dbAttempt.id,
    artifact_directory: bundle.directory,
  };
  if (
    apiAttempt.feedback_summary === null &&
    ['not_present', 'redacted'].includes(apiAttempt.feedback_capture_status)
  )
    return {
      ...common,
      status: KNOWN_LIVE_BLOCKER,
      classification: 'KNOWN_LIVE_BLOCKER',
      exit_code: EXIT_CODES[KNOWN_LIVE_BLOCKER],
      reason: 'fresh_db_feedback_present_but_api_feedback_null_or_redacted',
    };
  if (
    typeof apiAttempt.feedback_summary === 'string' &&
    apiAttempt.feedback_capture_status !== 'not_present' &&
    apiAttempt.feedback_capture_status !== 'redacted' &&
    Buffer.from(dbAttempt.feedback, 'utf8').equals(
      Buffer.from(apiAttempt.feedback_summary, 'utf8'),
    )
  )
    return {
      ...common,
      status: UNBLOCKED_CANDIDATE,
      classification: 'UNBLOCKED_CANDIDATE',
      exit_code: EXIT_CODES[UNBLOCKED_CANDIDATE],
      reason:
        'fresh_db_api_feedback_utf8_bytes_equal_under_non_redacted_status',
    };
  throw new MissingInput('fresh_db_api_feedback_or_status_mismatch');
}

async function loadFreshBundle(directory) {
  const bundle = { directory };
  const { manifest, manifestSha256 } = await recomputeBundleHashes(directory);
  bundle.manifest = manifest;
  bundle.manifestSha256 = manifestSha256;
  for (const file of PRODUCT_FILES.filter(
    (name) => name.endsWith('.json') && name !== 'manifest.json',
  ))
    bundle[file] = parseJson(await readFile(join(directory, file)), file);
  await validateRecording(directory, 'product');
  return bundle;
}

export async function runFreshCaptureEvaluatorPath({
  input,
  baseUrl,
  token,
  client,
  candidateSha,
  serviceRevision,
  startedAt,
  outputRoot,
  getJson = (path, name) => getAcceptedJson(baseUrl, token, path, name),
  assertDb = assertExistingWorkRun,
  capture = captureProductRun,
  loadBundle = loadFreshBundle,
  evaluate = evaluateFreshBundle,
}) {
  await assertDb(client, input);
  const workEnvelope = await getJson(
    `/api/v1/works/${input.workId}`,
    'live_work',
  );
  const workRunEnvelope = await getJson(
    `/api/v1/works/${input.workId}/runs/${input.workRunId}`,
    'live_work_run',
  );
  const traceEnvelope = await getJson(
    `/api/v1/works/${input.workId}/runs/${input.workRunId}/trace`,
    'live_trace',
  );
  const parsedWork = ProductWorkResponseSchema.safeParse(workEnvelope);
  if (!parsedWork.success)
    throw new MissingInput(
      `live_work_schema_invalid:${schemaIssues(parsedWork).join('|')}`,
    );
  const parsedWorkRun = ProductWorkRunResponseSchema.safeParse(workRunEnvelope);
  if (
    !parsedWorkRun.success ||
    parsedWorkRun.data.projection_status !== 'internally_anchored'
  )
    throw new MissingInput(
      `live_work_run_schema_invalid:${schemaIssues(parsedWorkRun).join('|')}`,
    );
  const parsedTrace = ProductRunTraceResponseSchema.safeParse(traceEnvelope);
  if (
    !parsedTrace.success ||
    parsedTrace.data.projection_status !== 'internally_anchored'
  )
    throw new MissingInput(
      `live_trace_schema_invalid:${schemaIssues(parsedTrace).join('|')}`,
    );
  const captureResult = await capture({
    baseUrl: String(baseUrl),
    token,
    rootTaskId: input.rootTaskId,
    workId: input.workId,
    workRunId: input.workRunId,
    work: parsedWork.data.work,
    workRun: parsedWorkRun.data.work_run,
    workRunResponse: parsedWorkRun.data,
    trace: parsedTrace.data,
    tenantId: input.C4_LIVE_TENANT_ID,
    workspaceId: input.C4_LIVE_WORKSPACE_ID,
    principalType: input.principalType,
    principalId: input.C4_LIVE_PRINCIPAL_ID,
    scenario: SCENARIO,
    memberComposition: [
      'projection-lead',
      'projection-worker',
      'projection-reviewer',
    ],
    submitInstructionProfile: SUBMIT_INSTRUCTION_PROFILE,
    providerKind: input.C4_LIVE_PROVIDER_KIND,
    providerModel: process.env.C4_LIVE_PROVIDER_MODEL ?? 'remote-service',
    definitionHash: input.C4_LIVE_DEFINITION_HASH,
    gitSha: candidateSha,
    serviceRevision,
    client,
    databaseUrl: input.C4_LIVE_DATABASE_URL,
    outputRoot,
  });
  const endedAt = Date.now();
  const fresh = await loadBundle(captureResult.directory);
  const verdict = evaluate(
    fresh,
    candidateSha,
    serviceRevision,
    startedAt,
    endedAt,
    input,
  );
  return { captureResult, verdict, endedAt };
}

function liveInput() {
  // Deliberately reject legacy/static trust inputs.  They are not evidence for
  // this arm and no caller-controlled candidate SHA is accepted.
  for (const name of [
    'C4_BLOCKER_BUNDLE_DIR',
    'C4_BLOCKER_BINDING_FILE',
    'C4_LIVE_BUNDLE_DIR',
    'C4_LIVE_SIDECAR',
    'C4_CANDIDATE_SHA',
    'C4_LIVE_CANDIDATE_SHA',
  ])
    if (process.env[name])
      throw new MissingInput(`caller_input_forbidden:${name}`);
  const values = Object.fromEntries(
    REQUIRED_ENV.map((name) => [name, required(name)]),
  );
  if (!FULL_HASH.test(values.C4_LIVE_DEFINITION_HASH))
    throw new MissingInput('live_definition_hash_invalid');
  return {
    ...values,
    rootTaskId: uuid(values.C4_LIVE_ROOT_TASK_ID, 'live_root_task_id'),
    workId: uuid(values.C4_LIVE_WORK_ID, 'live_work_id'),
    workRunId: uuid(values.C4_LIVE_WORK_RUN_ID, 'live_work_run_id'),
    tenantId: values.C4_LIVE_TENANT_ID,
    workspaceId: values.C4_LIVE_WORKSPACE_ID,
    principalId: values.C4_LIVE_PRINCIPAL_ID,
    principalType:
      process.env.C4_LIVE_PRINCIPAL_TYPE?.trim() || 'service_account',
  };
}

function missingVerdict(reason) {
  return {
    arm: LIVE_ARM,
    status: MISSING,
    classification: MISSING,
    exit_code: EXIT_CODES[MISSING],
    reason,
    assertion:
      'fresh capture, full current work-run/trace schemas, exact DB/API attempt join, and candidate binding are required',
    artifact_directory: null,
  };
}

async function writeStatus(input, verdict) {
  const evidenceRoot = input?.C4_LIVE_EVIDENCE_ROOT?.trim();
  if (!evidenceRoot || !isAbsolute(evidenceRoot)) return;
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  await writeFile(
    join(evidenceRoot, 'live-confirmation-status.json'),
    `${JSON.stringify(verdict, null, 2)}\n`,
    { mode: 0o600 },
  );
}

async function run() {
  const startedAt = Date.now();
  let input;
  let verdict;
  try {
    if (process.argv.slice(2).length > 0)
      throw new MissingInput('caller_arguments_forbidden');
    input = liveInput();
    const candidateSha = await readCandidateSha(
      input.C4_LIVE_REMOTE_WORKSPACE_ROOT,
    );
    const baseUrl = new URL(input.C4_LIVE_BASE_URL);
    if (!['http:', 'https:'].includes(baseUrl.protocol))
      throw new MissingInput('live_base_url_invalid');
    const client = new Client({ connectionString: input.C4_LIVE_DATABASE_URL });
    let connected = false;
    try {
      await client.connect();
      connected = true;
      const serviceRevision = await readServiceRevision(
        baseUrl,
        input.C4_LIVE_TOKEN,
      );
      const outputRoot = resolve(
        input.C4_LIVE_OUTPUT_ROOT,
        LIVE_ARM,
        `${new Date(startedAt).toISOString().replace(/[-:.]/gu, '')}-${process.pid}-${randomUUID()}`,
      );
      const result = await runFreshCaptureEvaluatorPath({
        input,
        baseUrl,
        token: input.C4_LIVE_TOKEN,
        client,
        candidateSha,
        serviceRevision,
        startedAt,
        outputRoot,
      });
      verdict = result.verdict;
      verdict.artifact_directory = result.captureResult.directory;
      verdict.runner_started_at = new Date(startedAt).toISOString();
      verdict.runner_ended_at = new Date(result.endedAt).toISOString();
      verdict.capture_validation = result.captureResult.validation;
    } finally {
      if (connected) await client.end();
    }
  } catch (error) {
    input ??= {
      C4_LIVE_EVIDENCE_ROOT: process.env.C4_LIVE_EVIDENCE_ROOT,
    };
    verdict = missingVerdict(
      error instanceof MissingInput
        ? error.reason
        : 'live_confirmation_internal_failure',
    );
  }
  await writeStatus(input, verdict).catch(() => undefined);
  process.stdout.write(`${JSON.stringify(verdict)}\n`);
  process.exitCode = verdict.exit_code;
}

if (import.meta.url === `file://${process.argv[1]}`) await run();
