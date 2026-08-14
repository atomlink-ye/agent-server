#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { runFreshCaptureEvaluatorPath } from './run-product-feedback-projection-live-confirmation.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RUNNER = join(
  ROOT,
  'scripts/ci/run-product-feedback-projection-live-confirmation.mjs',
);

function fail(reason) {
  throw new Error(`live_confirmation_shape_check_failed:${reason}`);
}

async function invoke(args = []) {
  return new Promise((resolvePromise) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', RUNNER, ...args],
      {
        cwd: ROOT,
        env: {
          PATH: process.env.PATH ?? '',
          NODE_PATH: process.env.NODE_PATH ?? '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => resolvePromise({ code, stdout, stderr }));
  });
}

const source = await readFile(RUNNER, 'utf8');
for (const marker of [
  'FEEDBACK_PROJECTION_LIVE_UNBLOCK_CONFIRMATION',
  'execFile',
  'rev-parse',
  'captureProductRun',
  "validateRecording(directory, 'product')",
  'ProductWorkRunResponseSchema.safeParse',
  'ProductWorkResponseSchema.safeParse',
  'ProductRunTraceResponseSchema.safeParse',
  'readServiceRevision',
  'runFreshCaptureEvaluatorPath',
  'fresh_db_feedback_nonempty_not_exactly_one',
  'fresh_db_api_feedback_or_status_mismatch',
]) {
  if (!source.includes(marker)) fail(`marker_missing:${marker}`);
}
for (const forbidden of [
  'readFile(resolve(bundleDirectory',
  'bundleDirectory',
]) {
  if (source.includes(forbidden))
    fail(`caller_bundle_path_present:${forbidden}`);
}

const missing = await invoke();
if (missing.code !== 2) fail(`missing_env_exit:${missing.code}`);
const missingResult = JSON.parse(missing.stdout);
if (
  missingResult.arm !== 'FEEDBACK_PROJECTION_LIVE_UNBLOCK_CONFIRMATION' ||
  missingResult.status !== 'MISSING' ||
  missingResult.exit_code !== 2
)
  fail('missing_env_verdict');
const bundleArg = await invoke(['--bundle-dir', '/tmp/caller-bundle']);
if (bundleArg.code !== 2) fail(`bundle_arg_exit:${bundleArg.code}`);
const bundleResult = JSON.parse(bundleArg.stdout);
if (
  bundleResult.status !== 'MISSING' ||
  !String(bundleResult.reason).includes('caller_arguments_forbidden')
)
  fail('bundle_arg_accepted');

const ids = {
  root: '00000000-0000-4000-8000-000000000001',
  work: '00000000-0000-4000-8000-000000000002',
  run: '00000000-0000-4000-8000-000000000003',
  team: '00000000-0000-4000-8000-000000000004',
  item: '00000000-0000-4000-8000-000000000005',
  attempt: '00000000-0000-4000-8000-000000000006',
  task: '00000000-0000-4000-8000-000000000007',
  execution: '00000000-0000-4000-8000-000000000008',
};
const timestamp = '2026-01-01T00:00:00.000Z';
const refs = {
  root_task_id: ids.root,
  team_run_id: ids.team,
  task_id: ids.task,
  run_id: ids.execution,
};
const work = {
  id: ids.work,
  tenant_id: 'tenant-live-harness',
  workspace_id: '00000000-0000-4000-8000-000000000009',
  definition_id: '00000000-0000-4000-8000-000000000010',
  definition_version_id: '00000000-0000-4000-8000-000000000011',
  title: 'Harness Work',
  origin: 'created',
  archived_at: null,
  created_at: timestamp,
  updated_at: timestamp,
};
const attempt = {
  id: ids.attempt,
  attempt_no: 1,
  status: 'completed',
  started_at: timestamp,
  ended_at: timestamp,
  duration_ms: 0,
  timing_capture_status: 'captured',
  feedback_summary: null,
  feedback_capture_status: 'redacted',
  result_summary: null,
  result_capture_status: 'not_present',
  source_refs: refs,
};
const workItem = {
  id: ids.item,
  subject: 'Harness item',
  description: null,
  status: 'accepted',
  actor_id: null,
  dependency_ids: [],
  attempts: [attempt],
  source_refs: {
    root_task_id: ids.root,
    team_run_id: ids.team,
  },
};
const workRunDetail = {
  id: ids.run,
  work_id: ids.work,
  definition_version_id: work.definition_version_id,
  trigger_kind: 'manual',
  trigger_ref: 'harness',
  expires_at: timestamp,
  bound_at: null,
  created_at: timestamp,
  updated_at: timestamp,
  product_state: 'complete',
  problem_kind: null,
  attention_reason: null,
  result_summary: null,
  result_capture_status: 'not_present',
  control_revision: null,
  cancel_availability: 'not_available',
  completion_decision_availability: 'not_available',
};
const projectionIdentity = {
  work_items: [workItem],
  actors: [],
  messages: [],
};
const workRunEnvelope = {
  work,
  work_run: workRunDetail,
  projection_status: 'internally_anchored',
  ...projectionIdentity,
};
const traceEnvelope = {
  ...workRunEnvelope,
  runs: [],
  events: [],
  edges: [
    {
      kind: 'feedback',
      guarantee: 'derived_relation',
      work_item_id: ids.item,
      attempt_id: ids.attempt,
      reviewer_actor_id: null,
      source_created_at: timestamp,
      source_refs: { team_run_id: ids.team, task_id: ids.task },
    },
  ],
  mcp_activities: [],
  timeline_coverage: {
    scope: 'mcp_dispatch_and_confirmation',
    completeness: 'mcp_only',
    excluded_execution: [
      'direct_shell',
      'direct_file_edit',
      'other_non_mcp_execution',
    ],
  },
};
const candidateSha = '0123456789abcdef0123456789abcdef01234567';
const input = {
  rootTaskId: ids.root,
  workId: ids.work,
  workRunId: ids.run,
  tenantId: work.tenant_id,
  workspaceId: work.workspace_id,
  principalId: 'svc-live-harness',
  principalType: 'service_account',
  C4_LIVE_TENANT_ID: work.tenant_id,
  C4_LIVE_WORKSPACE_ID: work.workspace_id,
  C4_LIVE_PRINCIPAL_ID: 'svc-live-harness',
  C4_LIVE_PROVIDER_KIND: 'harness',
  C4_LIVE_DEFINITION_HASH: 'a'.repeat(64),
  C4_LIVE_DATABASE_URL: 'postgres://harness.invalid/live',
};
const injectedBundle = {
  directory: 'injected-live-bundle',
  manifest: {
    format_version: 'product-projection-recording/v1',
    mode: 'product',
    provider_run: 'real',
    scenario: 'rework-once',
    root_task_id: ids.root,
    work_id: ids.work,
    work_run_id: ids.run,
    tenant_id: work.tenant_id,
    workspace_id: work.workspace_id,
    git_sha: candidateSha,
    service_revision: candidateSha,
    recorded_at: timestamp,
  },
  manifestSha256: 'b'.repeat(64),
  'api/work-run.json': workRunEnvelope,
  'api/trace.json': traceEnvelope,
  'db/team_runs.json': [
    {
      id: ids.team,
      root_task_id: ids.root,
      tenant_id: work.tenant_id,
      workspace_id: work.workspace_id,
    },
  ],
  'db/team_work_item_attempts.json': [
    {
      id: ids.attempt,
      work_item_id: ids.item,
      team_run_id: ids.team,
      requested_by_lead_task_id: ids.task,
      feedback: 'durable feedback',
    },
  ],
};
let dbAdapterCalled = false;
let captureAdapterCalled = false;
const injected = await runFreshCaptureEvaluatorPath({
  input,
  baseUrl: new URL('http://live-harness.invalid'),
  token: 'harness-token',
  client: { name: 'fake-db' },
  candidateSha,
  serviceRevision: candidateSha,
  startedAt: Date.parse(timestamp) - 1,
  outputRoot: 'injected-output-root',
  getJson: async (_path, name) =>
    ({
      live_work: { work },
      live_work_run: workRunEnvelope,
      live_trace: traceEnvelope,
    })[name],
  assertDb: async () => {
    dbAdapterCalled = true;
  },
  capture: async (options) => {
    captureAdapterCalled =
      options.work.id === ids.work &&
      options.workRun.id === ids.run &&
      options.workRunResponse.projection_status === 'internally_anchored' &&
      options.trace.edges[0].attempt_id === ids.attempt;
    return { directory: injectedBundle.directory };
  },
  loadBundle: async () => injectedBundle,
});
if (
  injected.verdict.status !==
    'FEEDBACK_PROJECTION_LIVE_UNBLOCK_CONFIRMATION_KNOWN_LIVE_BLOCKER' ||
  !dbAdapterCalled ||
  !captureAdapterCalled
)
  fail('injected_capture_evaluator_path');

async function runInjectedNegative(mutatedBundle) {
  try {
    const result = await runFreshCaptureEvaluatorPath({
      input,
      baseUrl: new URL('http://live-harness.invalid'),
      token: 'harness-token',
      client: { name: 'fake-db' },
      candidateSha,
      serviceRevision: candidateSha,
      startedAt: Date.parse(timestamp) - 1,
      outputRoot: 'injected-output-root',
      getJson: async (_path, name) =>
        ({
          live_work: { work },
          live_work_run: workRunEnvelope,
          live_trace: traceEnvelope,
        })[name],
      assertDb: async () => undefined,
      capture: async () => ({ directory: mutatedBundle.directory }),
      loadBundle: async () => mutatedBundle,
    });
    return result.verdict;
  } catch (error) {
    return {
      status: 'MISSING',
      exit_code: 2,
      reason: error?.reason ?? 'injected_negative_unexpected_error',
    };
  }
}

const traceWorkItemMismatch = structuredClone(injectedBundle);
traceWorkItemMismatch['api/trace.json'].work_items[0].id =
  '00000000-0000-4000-8000-000000000012';
const traceWorkItemMismatchResult = await runInjectedNegative(
  traceWorkItemMismatch,
);
if (
  traceWorkItemMismatchResult.status !== 'MISSING' ||
  traceWorkItemMismatchResult.exit_code !== 2
)
  fail('injected_trace_work_item_mismatch_not_missing');

const traceFeedbackMismatch = structuredClone(injectedBundle);
traceFeedbackMismatch[
  'api/trace.json'
].work_items[0].attempts[0].feedback_summary = 'trace-only feedback';
const traceFeedbackMismatchResult = await runInjectedNegative(
  traceFeedbackMismatch,
);
if (
  traceFeedbackMismatchResult.status !== 'MISSING' ||
  traceFeedbackMismatchResult.exit_code !== 2
)
  fail('injected_trace_feedback_mismatch_not_missing');

process.stdout.write(
  `${JSON.stringify({ arm: 'FEEDBACK_PROJECTION_LIVE_UNBLOCK_CONFIRMATION', status: 'LIVE_CONFIRMATION_PATH_INJECTED_HARNESS_PASSED', missing_env_exit: missing.code, caller_bundle_exit: bundleArg.code, injected_db_adapter: dbAdapterCalled, injected_capture_adapter: captureAdapterCalled, evaluator_status: injected.verdict.status, negative_trace_work_item_exit: traceWorkItemMismatchResult.exit_code, negative_trace_feedback_exit: traceFeedbackMismatchResult.exit_code })}\n`,
);
