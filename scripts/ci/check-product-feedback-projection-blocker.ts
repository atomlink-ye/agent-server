#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { ProductWorkRunResponseSchema } from '@atomlink-ye/agent-server/product-contract';

export const BLOCKER_STILL_PRESENT = 1;
export const UNBLOCKED_CANDIDATE = 0;
export const MISSING = 2;

const REPOSITORY_ROOT = resolve(
  fileURLToPath(new URL('../..', import.meta.url)),
);
const DEFAULT_BINDING_FILE = resolve(
  fileURLToPath(
    new URL(
      './product-feedback-projection-blocker-binding.json',
      import.meta.url,
    ),
  ),
);
const CURRENT_SCENARIO = 'rework-once';
const API_FILE = 'api/work-run.json';
const DB_FILE = 'db/team_work_item_attempts.json';
const FULL_SHA = /^[0-9a-f]{40}$/iu;
const FULL_HASH = /^[0-9a-f]{64}$/iu;
const HISTORICAL_MODE = 'historical_blocker_only' as const;
const FUTURE_MODE = 'future_fresh_candidate' as const;
const MAX_FUTURE_AGE_MS = 24 * 60 * 60 * 1000;

type JsonObject = Record<string, unknown>;

type Binding = {
  readonly schema_version: 1;
  readonly bundle_kind: 'historical_blocker_only';
  readonly scenario: 'rework-once';
  readonly authoritative_report: string;
  readonly authoritative_report_sha256: string;
  readonly product_revision: string;
  readonly manifest_sha256: string;
  readonly recorded_at: string;
  readonly service_revision: string;
  readonly identity: Readonly<{
    readonly root_task_id: string;
    readonly work_id: string;
    readonly work_run_id: string;
    readonly attempt_id: string;
  }>;
  readonly files: Readonly<Record<typeof API_FILE | typeof DB_FILE, string>>;
  readonly trust_root: 'checked-in-historical-binding';
};

type VerdictStatus =
  'BLOCKER_STILL_PRESENT' | 'UNBLOCKED_CANDIDATE' | 'MISSING';

type Verdict = {
  readonly status: VerdictStatus;
  readonly exit_code: 0 | 1 | 2;
  readonly assertion: string;
  readonly blocked_by: string;
  readonly would_be_green_if: string;
  readonly arm_that_proves_still_blocked: string;
  readonly last_verified: JsonObject | null;
  readonly reason?: string;
};

type LoadedInput = {
  readonly mode: typeof HISTORICAL_MODE | typeof FUTURE_MODE;
  readonly manifest: JsonObject;
  readonly manifestSha256: string;
  readonly api: unknown;
  readonly apiSha256: string;
  readonly dbRows: readonly unknown[];
  readonly dbSha256: string;
  readonly candidateSha: string | null;
  readonly productRevision: string | null;
  readonly expectedAttemptId: string | null;
};

class MissingInput extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'MissingInput';
  }
}

function object(value: unknown, name: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new MissingInput(`${name}_shape_unverifiable`);
  return value as JsonObject;
}

function stringField(value: JsonObject, field: string, name: string): string {
  const candidate = value[field];
  if (typeof candidate !== 'string' || candidate.length === 0)
    throw new MissingInput(`${name}_${field}_missing`);
  return candidate;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function jsonFile(
  path: string,
  name: string,
): Promise<{ readonly value: unknown; readonly bytes: Buffer }> {
  try {
    const bytes = await readFile(path);
    try {
      return { value: JSON.parse(bytes.toString('utf8')) as unknown, bytes };
    } catch {
      throw new MissingInput(`${name}_json_invalid`);
    }
  } catch (error) {
    if (error instanceof MissingInput) throw error;
    throw new MissingInput(`${name}_file_missing`);
  }
}

async function bytesFile(path: string, name: string): Promise<Buffer> {
  try {
    return await readFile(path);
  } catch {
    throw new MissingInput(`${name}_file_missing`);
  }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--'))
    throw new MissingInput(`argument_${name}_invalid`);
  return value;
}

function mode(): typeof HISTORICAL_MODE | typeof FUTURE_MODE {
  const value =
    argument('--mode') ?? process.env.C4_BLOCKER_MODE ?? HISTORICAL_MODE;
  if (value === HISTORICAL_MODE || value === FUTURE_MODE) return value;
  throw new MissingInput('mode_invalid');
}

function explicitCandidateSha(): string {
  const value = argument('--candidate-sha') ?? process.env.C4_CANDIDATE_SHA;
  if (!value || !FULL_SHA.test(value))
    throw new MissingInput('candidate_sha_missing_or_invalid');
  return value.toLowerCase();
}

function currentHead(): string {
  try {
    return execFileSync('git', ['-C', REPOSITORY_ROOT, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .toLowerCase();
  } catch {
    throw new MissingInput('candidate_repository_head_unreadable');
  }
}

function schemaIssues(result: {
  readonly success: boolean;
  readonly error?: {
    readonly issues: readonly {
      readonly path: readonly (string | number)[];
      readonly message: string;
    }[];
  };
}): readonly string[] {
  if (result.success || !result.error) return [];
  return result.error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || '<root>'}:${issue.message}`);
}

async function loadInput(): Promise<LoadedInput> {
  const selectedMode = mode();
  const bundleDirectory =
    argument('--bundle-dir') ?? process.env.C4_BLOCKER_BUNDLE_DIR;
  if (!bundleDirectory) throw new MissingInput('bundle_directory_missing');
  const bundle = resolve(bundleDirectory);
  if (argument('--binding-file') || process.env.C4_BLOCKER_BINDING_FILE)
    throw new MissingInput('external_binding_forbidden');
  let binding: Binding | null = null;
  let bindingIdentity: JsonObject | null = null;
  if (selectedMode === HISTORICAL_MODE) {
    const bindingInput = await jsonFile(DEFAULT_BINDING_FILE, 'binding');
    binding = object(bindingInput.value, 'binding') as unknown as Binding;
    if (
      binding.schema_version !== 1 ||
      binding.bundle_kind !== 'historical_blocker_only' ||
      binding.scenario !== CURRENT_SCENARIO ||
      binding.trust_root !== 'checked-in-historical-binding' ||
      !FULL_SHA.test(binding.product_revision) ||
      !binding.authoritative_report ||
      !FULL_HASH.test(binding.authoritative_report_sha256)
    )
      throw new MissingInput('binding_not_authoritative_historical_root');
    bindingIdentity = object(binding.identity, 'binding_identity');
  }

  const manifestInput = await jsonFile(
    resolve(bundle, 'manifest.json'),
    'manifest',
  );
  const manifest = object(manifestInput.value, 'manifest');
  const manifestSha256 = sha256(manifestInput.bytes);
  if (
    selectedMode === HISTORICAL_MODE &&
    (binding === null || manifestSha256 !== binding.manifest_sha256)
  )
    throw new MissingInput('historical_manifest_binding_hash_mismatch');
  if (
    stringField(manifest, 'format_version', 'manifest') !==
      'product-projection-recording/v1' ||
    stringField(manifest, 'scenario', 'manifest') !== CURRENT_SCENARIO ||
    stringField(manifest, 'provider_run', 'manifest') !== 'real'
  )
    throw new MissingInput('manifest_capture_identity_invalid');
  if (
    selectedMode === HISTORICAL_MODE &&
    (stringField(manifest, 'root_task_id', 'manifest') !==
      stringField(
        bindingIdentity as JsonObject,
        'root_task_id',
        'binding_identity',
      ) ||
      stringField(manifest, 'work_id', 'manifest') !==
        stringField(
          bindingIdentity as JsonObject,
          'work_id',
          'binding_identity',
        ) ||
      stringField(manifest, 'work_run_id', 'manifest') !==
        stringField(
          bindingIdentity as JsonObject,
          'work_run_id',
          'binding_identity',
        ))
  )
    throw new MissingInput('historical_identity_binding_mismatch');
  const recordedAt = Date.parse(
    stringField(manifest, 'recorded_at', 'manifest'),
  );
  if (!Number.isFinite(recordedAt) || recordedAt > Date.now() + 5 * 60 * 1000)
    throw new MissingInput('recorded_at_not_freshly_verifiable');
  if (
    selectedMode === HISTORICAL_MODE &&
    (stringField(manifest, 'recorded_at', 'manifest') !==
      (binding as Binding).recorded_at ||
      stringField(manifest, 'service_revision', 'manifest') !==
        (binding as Binding).service_revision)
  )
    throw new MissingInput('historical_freshness_binding_mismatch');
  if (
    selectedMode === FUTURE_MODE &&
    Date.now() - recordedAt > MAX_FUTURE_AGE_MS
  )
    throw new MissingInput('future_recording_too_old');
  if (selectedMode === HISTORICAL_MODE) {
    const reportBytes = await bytesFile(
      (binding as Binding).authoritative_report,
      'authoritative_report',
    );
    if (
      sha256(reportBytes) !== (binding as Binding).authoritative_report_sha256
    )
      throw new MissingInput('authoritative_report_hash_mismatch');
  }

  const apiInput = await jsonFile(resolve(bundle, API_FILE), API_FILE);
  const dbInput = await jsonFile(resolve(bundle, DB_FILE), DB_FILE);
  const manifestFiles = object(manifest.files, 'manifest_files');
  const apiSha256 = sha256(apiInput.bytes);
  const dbSha256 = sha256(dbInput.bytes);
  if (
    (selectedMode === HISTORICAL_MODE &&
      (apiSha256 !== (binding as Binding).files[API_FILE] ||
        dbSha256 !== (binding as Binding).files[DB_FILE])) ||
    object(manifestFiles[API_FILE], 'manifest_api_file').sha256 !== apiSha256 ||
    object(manifestFiles[DB_FILE], 'manifest_db_file').sha256 !== dbSha256
  )
    throw new MissingInput('recorded_file_hash_mismatch');
  if (!Array.isArray(dbInput.value))
    throw new MissingInput('db_feedback_rows_shape_unverifiable');

  let candidate: string | null = null;
  let productRevision: string | null =
    selectedMode === HISTORICAL_MODE
      ? (binding as Binding).product_revision
      : null;
  if (selectedMode === FUTURE_MODE) {
    const manifestCandidate = manifest.candidate_sha;
    if (
      typeof manifestCandidate !== 'string' ||
      !FULL_SHA.test(manifestCandidate)
    )
      throw new MissingInput('future_manifest_candidate_sha_missing');
    candidate = explicitCandidateSha();
    if (
      manifestCandidate.toLowerCase() !== candidate ||
      candidate !== currentHead()
    )
      throw new MissingInput('future_candidate_binding_mismatch');
    const captureSource = object(
      manifest.capture_source,
      'manifest_capture_source',
    );
    if (
      captureSource.kind !== 'accepted-endpoint-db-snapshot' ||
      captureSource.api_file !== API_FILE ||
      captureSource.db_file !== DB_FILE ||
      captureSource.api_sha256 !== apiSha256 ||
      captureSource.db_sha256 !== dbSha256 ||
      typeof captureSource.provenance_sha256 !== 'string' ||
      !FULL_HASH.test(captureSource.provenance_sha256) ||
      captureSource.provenance_sha256 !==
        createHash('sha256')
          .update(`${candidate}\n${apiSha256}\n${dbSha256}`)
          .digest('hex')
    )
      throw new MissingInput('future_capture_source_unverifiable');
    productRevision = manifestCandidate;
  }

  return {
    mode: selectedMode,
    manifest,
    manifestSha256,
    api: apiInput.value,
    apiSha256,
    dbRows: dbInput.value,
    dbSha256,
    candidateSha: candidate,
    productRevision,
    expectedAttemptId:
      selectedMode === HISTORICAL_MODE
        ? stringField(
            bindingIdentity as JsonObject,
            'attempt_id',
            'binding_identity',
          )
        : null,
  };
}

function lastVerified(
  input: LoadedInput,
  attemptId: string,
  status: VerdictStatus,
): JsonObject {
  return {
    status,
    mode: input.mode,
    scenario: CURRENT_SCENARIO,
    recorded_at: input.manifest.recorded_at,
    service_revision: input.manifest.service_revision,
    product_revision: input.productRevision,
    candidate_sha: input.candidateSha,
    manifest_sha256: input.manifestSha256,
    api_work_run_sha256: input.apiSha256,
    db_attempts_sha256: input.dbSha256,
    attempt_id: attemptId,
  };
}

function evaluate(input: LoadedInput): Verdict {
  const parsed = ProductWorkRunResponseSchema.safeParse(input.api);
  if (!parsed.success)
    throw new MissingInput(
      `api_schema_invalid:${schemaIssues(parsed).join('|')}`,
    );
  if (parsed.data.projection_status !== 'internally_anchored')
    throw new MissingInput('api_shape_not_anchored');
  const manifestWorkRunId = stringField(
    input.manifest,
    'work_run_id',
    'manifest',
  );
  const manifestWorkId = stringField(input.manifest, 'work_id', 'manifest');
  if (
    parsed.data.work_run.id !== manifestWorkRunId ||
    parsed.data.work.id !== manifestWorkId
  )
    throw new MissingInput('manifest_api_identity_mismatch');

  const dbFeedbackRows = input.dbRows.filter((row) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row))
      return false;
    const feedback = (row as JsonObject).feedback;
    return typeof feedback === 'string' && feedback.trim().length > 0;
  });
  if (dbFeedbackRows.length !== 1)
    throw new MissingInput('db_feedback_non_unique_or_empty');
  const dbRow = object(dbFeedbackRows[0], 'db_feedback_row');
  const attemptId = stringField(dbRow, 'id', 'db_feedback_row');
  if (input.expectedAttemptId !== null && input.expectedAttemptId !== attemptId)
    throw new MissingInput('historical_attempt_identity_mismatch');
  const dbFeedback = dbRow.feedback;
  if (typeof dbFeedback !== 'string' || dbFeedback.length === 0)
    throw new MissingInput('db_feedback_empty');

  const apiAttempts = parsed.data.work_items.flatMap((item) => item.attempts);
  const sameAttempts = apiAttempts.filter(
    (attempt) => attempt.id === attemptId,
  );
  if (sameAttempts.length !== 1)
    throw new MissingInput('api_same_attempt_non_unique_or_missing');
  const apiAttempt = sameAttempts[0];
  if (
    apiAttempt.source_refs.root_task_id !==
    stringField(input.manifest, 'root_task_id', 'manifest')
  )
    throw new MissingInput('attempt_root_task_binding_mismatch');
  if (dbRow.team_run_id !== apiAttempt.source_refs.team_run_id)
    throw new MissingInput('attempt_team_run_binding_mismatch');

  const apiFeedback = apiAttempt.feedback_summary;
  const apiStatus = apiAttempt.feedback_capture_status;
  const base = {
    assertion:
      'unique same-attempt DB feedback is compared with the full current ProductWorkRunResponseSchema API attempt',
    blocked_by:
      'Product projection reports feedback_summary=null and feedback_capture_status=redacted despite durable DB feedback',
    would_be_green_if:
      'the same attempt is byte-for-byte equal in DB/API and the accepted contract exposes a status other than not_present or redacted',
    arm_that_proves_still_blocked:
      'checked-in historical W-REC rework-once bundle; no static replay or E11 full/partial arm can substitute',
  } as const;
  if (apiFeedback === null && apiStatus === 'redacted')
    return {
      ...base,
      status: 'BLOCKER_STILL_PRESENT',
      exit_code: BLOCKER_STILL_PRESENT,
      last_verified: lastVerified(input, attemptId, 'BLOCKER_STILL_PRESENT'),
    };
  if (input.mode === HISTORICAL_MODE)
    throw new MissingInput('historical_nonblocking_cannot_unblock');
  if (
    typeof apiFeedback === 'string' &&
    Buffer.from(dbFeedback).equals(Buffer.from(apiFeedback)) &&
    apiStatus !== 'not_present' &&
    apiStatus !== 'redacted'
  )
    return {
      ...base,
      status: 'UNBLOCKED_CANDIDATE',
      exit_code: UNBLOCKED_CANDIDATE,
      last_verified: lastVerified(input, attemptId, 'UNBLOCKED_CANDIDATE'),
    };
  throw new MissingInput('db_api_feedback_or_status_mismatch');
}

function missingVerdict(reason: string): Verdict {
  return {
    status: 'MISSING',
    exit_code: MISSING,
    assertion:
      'unique same-attempt DB feedback and a full current ProductWorkRunResponseSchema parse are required',
    blocked_by:
      'freshness, provenance, schema, identity, uniqueness, or projection-shape evidence is incomplete',
    would_be_green_if:
      'the complete current contract and byte-equal same-attempt projection are proven',
    arm_that_proves_still_blocked: 'not established by this invocation',
    last_verified: null,
    reason,
  };
}

async function main(): Promise<void> {
  let verdict: Verdict;
  try {
    verdict = evaluate(await loadInput());
  } catch (error) {
    verdict = missingVerdict(
      error instanceof MissingInput ? error.reason : 'checker_internal_failure',
    );
  }
  process.stdout.write(`${JSON.stringify(verdict)}\n`);
  process.exitCode = verdict.exit_code;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
