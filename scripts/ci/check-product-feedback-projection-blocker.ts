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

type JsonObject = Record<string, unknown>;

type Binding = {
  readonly schema_version: 1;
  readonly bundle_kind: 'current-rework';
  readonly scenario: 'rework-once';
  readonly manifest_sha256: string;
  readonly recorded_at: string;
  readonly service_revision: string;
  readonly files: Readonly<Record<typeof API_FILE | typeof DB_FILE, string>>;
  readonly candidate_binding: {
    readonly kind: 'repository-head';
    readonly env: 'C4_CANDIDATE_SHA';
  };
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
  readonly manifest: JsonObject;
  readonly manifestSha256: string;
  readonly api: unknown;
  readonly apiSha256: string;
  readonly dbRows: readonly unknown[];
  readonly dbSha256: string;
  readonly candidateSha: string;
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

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--'))
    throw new MissingInput(`argument_${name}_invalid`);
  return value;
}

function candidateSha(): string {
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

function bindingFile(): string {
  return resolve(
    argument('--binding-file') ??
      process.env.C4_BLOCKER_BINDING_FILE ??
      DEFAULT_BINDING_FILE,
  );
}

async function loadInput(): Promise<LoadedInput> {
  const bundleDirectory =
    argument('--bundle-dir') ?? process.env.C4_BLOCKER_BUNDLE_DIR;
  if (!bundleDirectory) throw new MissingInput('bundle_directory_missing');
  const bundle = resolve(bundleDirectory);
  const bindingInput = await jsonFile(bindingFile(), 'binding');
  const binding = object(bindingInput.value, 'binding') as unknown as Binding;
  if (
    binding.schema_version !== 1 ||
    binding.bundle_kind !== 'current-rework' ||
    binding.scenario !== CURRENT_SCENARIO ||
    binding.candidate_binding?.kind !== 'repository-head' ||
    binding.candidate_binding.env !== 'C4_CANDIDATE_SHA'
  )
    throw new MissingInput('binding_not_current_rework');

  const candidate = candidateSha();
  if (candidate !== currentHead())
    throw new MissingInput('candidate_sha_not_current_repository_head');

  const manifestInput = await jsonFile(
    resolve(bundle, 'manifest.json'),
    'manifest',
  );
  const manifest = object(manifestInput.value, 'manifest');
  const manifestSha256 = sha256(manifestInput.bytes);
  if (manifestSha256 !== binding.manifest_sha256)
    throw new MissingInput('manifest_binding_hash_mismatch');
  if (
    stringField(manifest, 'format_version', 'manifest') !==
      'product-projection-recording/v1' ||
    stringField(manifest, 'scenario', 'manifest') !== CURRENT_SCENARIO ||
    stringField(manifest, 'provider_run', 'manifest') !== 'real' ||
    stringField(manifest, 'recorded_at', 'manifest') !== binding.recorded_at ||
    stringField(manifest, 'service_revision', 'manifest') !==
      binding.service_revision
  )
    throw new MissingInput('manifest_freshness_binding_mismatch');
  const recordedAt = Date.parse(binding.recorded_at);
  if (!Number.isFinite(recordedAt) || recordedAt > Date.now() + 5 * 60 * 1000)
    throw new MissingInput('recorded_at_not_freshly_verifiable');

  const apiInput = await jsonFile(resolve(bundle, API_FILE), API_FILE);
  const dbInput = await jsonFile(resolve(bundle, DB_FILE), DB_FILE);
  const manifestFiles = object(manifest.files, 'manifest_files');
  const apiSha256 = sha256(apiInput.bytes);
  const dbSha256 = sha256(dbInput.bytes);
  if (
    apiSha256 !== binding.files[API_FILE] ||
    dbSha256 !== binding.files[DB_FILE] ||
    object(manifestFiles[API_FILE], 'manifest_api_file').sha256 !== apiSha256 ||
    object(manifestFiles[DB_FILE], 'manifest_db_file').sha256 !== dbSha256
  )
    throw new MissingInput('recorded_file_hash_mismatch');
  if (!Array.isArray(dbInput.value))
    throw new MissingInput('db_feedback_rows_shape_unverifiable');

  return {
    manifest,
    manifestSha256,
    api: apiInput.value,
    apiSha256,
    dbRows: dbInput.value,
    dbSha256,
    candidateSha: candidate,
  };
}

function lastVerified(
  input: LoadedInput,
  attemptId: string,
  status: VerdictStatus,
): JsonObject {
  return {
    status,
    scenario: CURRENT_SCENARIO,
    recorded_at: input.manifest.recorded_at,
    service_revision: input.manifest.service_revision,
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
      'current rework-once recorder bundle; no static replay or E11 full/partial arm can substitute',
  } as const;
  if (apiFeedback === null && apiStatus === 'redacted')
    return {
      ...base,
      status: 'BLOCKER_STILL_PRESENT',
      exit_code: BLOCKER_STILL_PRESENT,
      last_verified: lastVerified(input, attemptId, 'BLOCKER_STILL_PRESENT'),
    };
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
