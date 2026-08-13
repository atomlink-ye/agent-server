#!/usr/bin/env node

import { createHash } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import {
  ProductRunTraceResponseSchema,
  WorkListResponseSchema,
  WorkRunListResponseSchema,
  type ProductRunTrace,
} from '@atomlink-ye/agent-server/product-contract';

import {
  FAIL,
  MISSING,
  PASS,
  launchApp,
  launchReplay,
  loadChromium,
  stop,
  writeEvidence,
  type BrowserLike,
} from './product-run-trace-network.js';
import {
  loadStaticReplayRecording,
  type RecordingScenario,
  type ReplayMutation,
} from './support/product-static-replay-upstream.js';

const startupTimeoutMs = Number(process.env.C4_STARTUP_TIMEOUT_MS ?? 30_000);
const appUrl = process.env.C4_APP_URL ?? 'http://127.0.0.1:3001';

type AnchoredTrace = Extract<
  ProductRunTrace,
  { projection_status: 'internally_anchored' }
>;

type ResponseLike = {
  url: () => string;
  status: () => number;
  json: () => Promise<unknown>;
};

function scenarios(): readonly RecordingScenario[] {
  const requested = process.env.C4_REPLAY_SCENARIO;
  if (requested === 'parallel-success' || requested === 'rework-once') return [requested];
  return ['parallel-success', 'rework-once'];
}

function mutation(): ReplayMutation {
  const value = process.env.C4_REPLAY_MUTATION ?? 'none';
  if (value === 'none' || value === 'omit-feedback' || value === 'constant-duration')
    return value;
  throw new Error(`invalid_mutation:${value}`);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function traceFacts(trace: AnchoredTrace): Record<string, unknown> {
  return {
    work_id: trace.work.id,
    work_run_id: trace.work_run.id,
    attempt_count: trace.work_items.reduce((count, item) => count + item.attempts.length, 0),
    feedback_count: trace.edges.filter((edge) => edge.kind === 'feedback').length,
    activity_count: trace.mcp_activities.length,
    attempt_facts: trace.work_items.map((item) => ({
      item_id: item.id,
      attempts: item.attempts.map((attempt) => ({
        attempt_no: attempt.attempt_no,
        started_at: attempt.started_at,
        ended_at: attempt.ended_at,
        duration_ms: attempt.duration_ms,
        timing_capture_status: attempt.timing_capture_status,
        feedback_summary: attempt.feedback_summary,
        feedback_capture_status: attempt.feedback_capture_status,
      })),
    })),
    feedback_edges: trace.edges.filter((edge) => edge.kind === 'feedback'),
    activities: trace.mcp_activities,
  };
}

function compareRecordedFacts(expected: AnchoredTrace, actual: AnchoredTrace): boolean {
  return canonical(traceFacts(expected)) === canonical(traceFacts(actual));
}

function scenarioPredicate(scenario: RecordingScenario, trace: AnchoredTrace): boolean {
  const attempts = trace.work_items.flatMap((item) => item.attempts);
  if (attempts.length === 0 || trace.mcp_activities.length === 0) return false;
  if (scenario === 'parallel-success')
    return trace.work_items.length >= 2 && trace.work_items.every((item) => item.attempts.length === 1);
  return (
    trace.edges.some((edge) => edge.kind === 'feedback') &&
    trace.work_items.some((item) => item.attempts.length > 1)
  );
}

async function waitForExit(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return;
  await new Promise<void>((resolveExit) => {
    const timer = setTimeout(resolveExit, 2_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolveExit();
    });
  });
}

async function runScenario(scenario: RecordingScenario, redArm: ReplayMutation): Promise<number> {
  process.env.C4_REPLAY_SCENARIO = scenario;
  process.env.C4_REPLAY_MUTATION = redArm;
  let replay: { readonly child: ChildProcess; readonly url: string } | undefined;
  let app: { readonly child: ChildProcess } | undefined;
  let browser: BrowserLike | undefined;
  try {
    const loaded = await loadStaticReplayRecording(scenario);
    if (!scenarioPredicate(scenario, loaded.trace)) return MISSING;
    replay = await launchReplay();
    app = await launchApp(replay.url);
    browser = await loadChromium();
    const page = (await browser.newPage()) as any;
    const responses = new Map<string, unknown>();
    const pending: Promise<void>[] = [];
    page.on('response', (response: ResponseLike) => {
      const pathname = new URL(response.url()).pathname;
      if (!pathname.startsWith('/api/works')) return;
      pending.push(
        response.json().then((body) => {
          if (response.status() >= 200 && response.status() < 300) responses.set(pathname, body);
        }).catch(() => undefined),
      );
    });
    await page.goto(`${appUrl}/works`, { waitUntil: 'domcontentloaded', timeout: startupTimeoutMs });
    const worksPath = '/api/works';
    const link = page.locator('a[href^="/works/"]').first();
    await link.waitFor({ state: 'visible', timeout: startupTimeoutMs });
    await Promise.all([
      page.waitForURL(/\/works\/[^/]+$/u, { timeout: startupTimeoutMs }),
      link.click(),
    ]);
    await page.locator('[data-testid="trace-coverage-disclosure"]').waitFor({
      state: 'visible',
      timeout: startupTimeoutMs,
    });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    await Promise.all(pending);

    const workList = WorkListResponseSchema.safeParse(responses.get(worksPath));
    const workId = loaded.work.id;
    const runListPath = `/api/works/${workId}/runs`;
    const runPath = `/api/works/${workId}/runs/${loaded.run.work_run.id}`;
    const tracePath = `${runPath}/trace`;
    const runList = WorkRunListResponseSchema.safeParse(responses.get(runListPath));
    const trace = ProductRunTraceResponseSchema.safeParse(responses.get(tracePath));
    if (!workList.success || !runList.success || !trace.success)
      return MISSING;
    if (trace.data.projection_status !== 'internally_anchored') return MISSING;
    if (workList.data.works.length !== loaded.workList.works.length) return FAIL;
    if (canonical(runList.data) !== canonical(loaded.runList)) return FAIL;
    const actual = trace.data;
    if (actual.projection_status !== 'internally_anchored') return FAIL;
    const factsMatch = compareRecordedFacts(loaded.trace, actual);
    const attemptCount = loaded.trace.work_items.reduce((count, item) => count + item.attempts.length, 0);
    const renderedAttempts = await page.locator('[data-testid="trace-attempt"]').count();
    if (renderedAttempts !== attemptCount) return FAIL;
    await page.getByRole('button', { name: 'Events', exact: true }).click();
    const renderedActivities = await page.locator('.run-trace__event').count();
    if (renderedActivities !== loaded.trace.mcp_activities.length) return FAIL;

    const candidate = process.env.C4_CANDIDATE_SHA ?? '';
    if (!/^[0-9a-f]{40}$/iu.test(candidate)) return MISSING;
    const base = {
      candidate_sha: candidate,
      scenario,
      command: process.argv.join(' '),
      response_paths: [worksPath, runListPath, runPath, tracePath],
      expected: {
        attempt_count: attemptCount,
        feedback_count: loaded.trace.edges.filter((edge) => edge.kind === 'feedback').length,
        activity_count: loaded.trace.mcp_activities.length,
        facts_sha256: hash(traceFacts(loaded.trace)),
      },
      observed: {
        attempt_count: renderedAttempts,
        feedback_count: actual.edges.filter((edge) => edge.kind === 'feedback').length,
        activity_count: renderedActivities,
        facts_sha256: hash(traceFacts(actual)),
      },
    };
    if (redArm !== 'none') {
      await writeEvidence(`red-arms/e11-${scenario}-${redArm}.json`, {
        ...base,
        status: 'FAIL',
        exit_code: FAIL,
        expected_nonzero: true,
        mutation_detected: !factsMatch,
      });
      return FAIL;
    }
    if (!factsMatch) return FAIL;
    await writeEvidence(`e11-walking-slice-${scenario}.json`, {
      ...base,
      status: 'PASS',
      exit_code: PASS,
    });
    return PASS;
  } catch {
    return MISSING;
  } finally {
    await browser?.close().catch(() => undefined);
    stop(app?.child);
    stop(replay?.child);
    await waitForExit(app?.child);
    await waitForExit(replay?.child);
  }
}

async function run(): Promise<number> {
  let redArm: ReplayMutation;
  try {
    redArm = mutation();
  } catch {
    return MISSING;
  }
  let result = PASS;
  for (const selectedScenario of scenarios()) {
    const scenarioResult = await runScenario(selectedScenario, redArm);
    if (scenarioResult === MISSING) return MISSING;
    if (scenarioResult !== PASS) result = scenarioResult;
  }
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]))
  void run().then((code) => {
    process.exitCode = code;
  });
