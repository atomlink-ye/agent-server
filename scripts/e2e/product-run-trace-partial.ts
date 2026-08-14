#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import type { ChildProcess } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ProductRunTrace } from '@atomlink-ye/agent-server/product-contract';

import {
  FAIL,
  MISSING,
  PASS,
  launchApp,
  launchReplay,
  loadChromium,
  parseAcceptedProductResponse,
  type BrowserLike,
} from './product-run-trace-network.js';
import { cleanupOwnedProcess } from './support/owned-process-cleanup.mjs';
import { createPageObserver } from './support/page-observer.mjs';
import {
  loadStaticReplayRecording,
  type RecordingScenario,
} from './support/product-static-replay-upstream.js';

export const PARTIAL_MACHINE_NAME = 'E11_STRUCTURAL_RELATIONSHIP_PARTIAL';
export const FULL_MACHINE_NAME = 'E11_FULL_PRODUCT_JOURNEY';
export const FULL_BLOCKED_STATUS = 'BLOCKED_BY_PRODUCT_DEFECT';
const PARTIAL_PASS_MARKER = 'E11_STRUCTURAL_RELATIONSHIP_PARTIAL_PASS';
const startupTimeoutMs = Number(process.env.C4_STARTUP_TIMEOUT_MS ?? 30_000);
const appUrl = process.env.C4_APP_URL ?? 'http://127.0.0.1:3001';
const feedbackMarkerSelector = '[aria-label="Recorded feedback relation"]';
const feedbackStatusRepresentation = 'Captured, content redacted';

type AnchoredTrace = Extract<
  ProductRunTrace,
  { projection_status: 'internally_anchored' }
>;
type RedArm = 'none' | 'edge' | 'attempt' | 'count' | 'status' | 'marker';
type PartialFacts = {
  readonly attempts: readonly AnchoredTrace['work_items'][number]['attempts'][number][];
  readonly feedbackEdges: readonly AnchoredTrace['edges'][number][];
  readonly feedbackAttempt: AnchoredTrace['work_items'][number]['attempts'][number] | undefined;
  readonly expectedMarkerCount: number;
};
type DomFacts = {
  readonly mismatches: readonly string[];
  readonly markerCount: number;
  readonly attemptCount: number;
  readonly statusPresent: boolean;
};

function scenario(): RecordingScenario {
  return process.env.C4_REPLAY_SCENARIO === undefined
    ? 'rework-once'
    : process.env.C4_REPLAY_SCENARIO === 'rework-once'
      ? 'rework-once'
      : (() => { throw new Error('partial_requires_rework_once'); })();
}

function redArm(): RedArm {
  const value = process.env.C4_E11_PARTIAL_RED_ARM ?? 'none';
  if (value === 'none' || value === 'edge' || value === 'attempt' || value === 'count' || value === 'status' || value === 'marker') return value;
  throw new Error(`invalid_partial_red_arm:${value}`);
}

function candidateSha(): string {
  const value = process.env.C4_CANDIDATE_SHA ?? '';
  if (!/^[0-9a-f]{40}$/iu.test(value)) throw new Error('candidate_sha_missing_or_invalid');
  return value;
}

function partialEvidenceDirectory(): string {
  const value = process.env.C4_E11_PARTIAL_EVIDENCE_DIR;
  if (!value) throw new Error('partial_evidence_directory_missing');
  return resolve(value);
}

async function writePartialEvidence(name: string, payload: Record<string, unknown>): Promise<void> {
  const target = resolve(partialEvidenceDirectory(), name);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function facts(trace: AnchoredTrace): PartialFacts | undefined {
  const attempts = trace.work_items.flatMap((item) => item.attempts);
  const feedbackEdges = trace.edges.filter((edge) => edge.kind === 'feedback');
  const feedbackEdge = feedbackEdges.length === 1 ? feedbackEdges[0] : undefined;
  const feedbackAttempt = feedbackEdge?.attempt_id === null || feedbackEdge?.attempt_id === undefined
    ? undefined
    : attempts.find((attempt) => attempt.id === feedbackEdge.attempt_id);
  if (!feedbackEdge || !feedbackAttempt || feedbackEdge.work_item_id === null)
    return undefined;
  const owner = trace.work_items.find((item) => item.id === feedbackEdge.work_item_id);
  if (!owner || !owner.attempts.some((attempt) => attempt.id === feedbackAttempt.id)) return undefined;
  return { attempts, feedbackEdges, feedbackAttempt, expectedMarkerCount: feedbackEdges.length };
}

function assertRecordedFacts(expected: PartialFacts): boolean {
  return expected.attempts.length > 0 &&
    expected.feedbackEdges.length === 1 &&
    expected.feedbackAttempt !== undefined &&
    expected.feedbackAttempt.feedback_capture_status === 'redacted';
}

async function assertDom(page: any, expected: PartialFacts): Promise<DomFacts> {
  const mismatches: string[] = [];
  const markers = page.locator(feedbackMarkerSelector);
  const markerCount = await markers.count();
  if (markerCount !== expected.expectedMarkerCount) mismatches.push('feedback_marker_count');
  if (markerCount > 0) {
    const relation = await markers.nth(0).getAttribute('data-attempt-id');
    if (relation !== expected.feedbackAttempt?.id) mismatches.push('feedback_edge');
  }

  const attempts = page.locator('[data-testid="trace-attempt"]');
  const attemptCount = await attempts.count();
  if (attemptCount !== expected.attempts.length) mismatches.push('attempt_count');
  let statusPresent = false;
  for (let index = 0; index < attemptCount; index += 1) {
    const button = attempts.nth(index);
    const aria = await button.getAttribute('aria-label');
    if (aria?.includes(`Attempt ${expected.feedbackAttempt?.attempt_no}`)) {
      await button.click();
      const inspector = page.locator('.run-trace__inspector');
      const text = (await inspector.textContent()) ?? '';
      statusPresent = text.includes(feedbackStatusRepresentation);
      if (!statusPresent) mismatches.push('feedback_capture_status');
      break;
    }
  }
  if (!statusPresent && !mismatches.includes('feedback_capture_status')) mismatches.push('feedback_attempt');
  if (markerCount === 0) mismatches.push('feedback_edge');
  return { mismatches, markerCount, attemptCount, statusPresent };
}

async function applyMutation(page: any, expected: PartialFacts, arm: RedArm): Promise<boolean> {
  if (arm === 'none') return true;
  return Boolean(await page.evaluate(({ selector, attemptNo, arm: mutationArm }: { selector: string; attemptNo: number; arm: RedArm }) => {
    const marker = document.querySelector(selector);
    if (mutationArm === 'edge') {
      if (!marker) return false;
      marker.setAttribute('data-attempt-id', 'mutated-attempt-relation');
      return true;
    }
    if (mutationArm === 'marker') {
      if (!marker) return false;
      marker.remove();
      return true;
    }
    if (mutationArm === 'count') {
      if (!marker || !marker.parentElement) return false;
      marker.parentElement.append(marker.cloneNode(true));
      return true;
    }
    const attempt = [...document.querySelectorAll<HTMLElement>('[data-testid="trace-attempt"]')]
      .find((candidate) => candidate.getAttribute('aria-label')?.includes(`Attempt ${attemptNo}`));
    if (!attempt) return false;
    if (mutationArm === 'attempt') {
      attempt.setAttribute('aria-label', 'mutated attempt');
      return true;
    }
    const inspector = document.querySelector('.run-trace__inspector');
    if (!inspector) return false;
    inspector.textContent = 'Feedback Not captured';
    return true;
  }, { selector: feedbackMarkerSelector, attemptNo: expected.feedbackAttempt?.attempt_no ?? -1, arm }));
}

function baseEvidence(candidate: string, trace: AnchoredTrace, expected: PartialFacts, observed: DomFacts) {
  return {
    machine_name: PARTIAL_MACHINE_NAME,
    candidate_sha: candidate,
    scenario: 'rework-once',
    command: process.argv.join(' '),
    aggregate: {
      full_machine_name: FULL_MACHINE_NAME,
      full_status: FULL_BLOCKED_STATUS,
      partial_machine_name: PARTIAL_MACHINE_NAME,
      partial_status: 'INDEPENDENT',
    },
    included_fields: [
      'feedback edge existence',
      'edge.attempt relation',
      'attempt and feedback counts',
      'feedback marker count',
      'feedback_capture_status enum and DOM representation',
    ],
    excluded_fields: {
      feedback_content: 'blocked_by_product_defect',
    },
    expected: {
      attempt_count: expected.attempts.length,
      feedback_edge_count: expected.feedbackEdges.length,
      feedback_marker_count: expected.expectedMarkerCount,
      feedback_attempt_id: expected.feedbackAttempt?.id,
      feedback_capture_status: 'redacted',
      source_attempt_relation: expected.feedbackAttempt !== undefined,
    },
    observed: {
      attempt_count: observed.attemptCount,
      feedback_marker_count: observed.markerCount,
      feedback_capture_status_dom: observed.statusPresent,
      trace_attempt_count: trace.work_items.reduce((count, item) => count + item.attempts.length, 0),
    },
    mismatches: observed.mismatches,
  };
}

async function runPartial(): Promise<number> {
  let replay: { child: ChildProcess; url: string } | undefined;
  let app: { child: ChildProcess } | undefined;
  let browser: BrowserLike | undefined;
  try {
    const selectedScenario = scenario();
    const arm = redArm();
    const loaded = await loadStaticReplayRecording(selectedScenario);
    const expected = facts(loaded.trace);
    if (!expected || !assertRecordedFacts(expected)) return MISSING;
    const expectedPaths = [
      '/api/works',
      `/api/works/${encodeURIComponent(loaded.work.id)}`,
      `/api/works/${encodeURIComponent(loaded.work.id)}/runs`,
      `/api/works/${encodeURIComponent(loaded.work.id)}/runs/${encodeURIComponent(loaded.run.work_run.id)}`,
      `/api/works/${encodeURIComponent(loaded.work.id)}/runs/${encodeURIComponent(loaded.run.work_run.id)}/trace`,
    ];
    const responses = new Map<string, unknown>();
    replay = await launchReplay();
    app = await launchApp(replay.url);
    browser = await loadChromium();
    const page = (await browser.newPage()) as any;
    const observer = createPageObserver({
      page,
      origin: new URL(appUrl).origin,
      allowlist: expectedPaths.map((path) => ({ method: 'GET', path, query: '' })),
      parseBody: async (record: { readonly path: string; readonly responseStatus: number | null }, body: unknown) => {
        if (record.responseStatus !== null && record.responseStatus >= 200 && record.responseStatus < 300 && parseAcceptedProductResponse(record.path, body))
          responses.set(record.path, body);
      },
    });
    observer.attach();
    await page.goto(`${appUrl}/works`, { waitUntil: 'domcontentloaded', timeout: startupTimeoutMs });
    const link = page.getByRole('link', { name: loaded.work.title, exact: true });
    if (await link.count() !== 1) return MISSING;
    if (await link.getAttribute('href') !== `/works/${encodeURIComponent(loaded.work.id)}`) return MISSING;
    await Promise.all([
      page.waitForURL(/\/works\/[^/]+$/u, { timeout: startupTimeoutMs }),
      link.click(),
    ]);
    await page.locator('[data-testid="trace-coverage-disclosure"]').waitFor({ state: 'visible', timeout: startupTimeoutMs });
    const observedLifecycle = await observer.seal({ domStable: async () => true });
    const verdict = observer.verdict({ expectedResponseCounts: Object.fromEntries(expectedPaths.map((path) => [`GET ${path}`, 1])) });
    if (verdict.verdict === 'MISSING_EVIDENCE') return MISSING;
    if (verdict.verdict === 'UNSOUND_ABSENCE') return FAIL;
    const tracePath = expectedPaths[4]!;
    const traceResponse = parseAcceptedProductResponse(tracePath, responses.get(tracePath));
    if (!traceResponse || traceResponse.route !== 'trace' || traceResponse.body.projection_status !== 'internally_anchored') return MISSING;
    const actual = traceResponse.body;
    const observedTraceFacts = facts(actual);
    if (!observedTraceFacts || !assertRecordedFacts(observedTraceFacts)) return MISSING;
    if (
      observedTraceFacts.attempts.length !== expected.attempts.length ||
      observedTraceFacts.feedbackEdges.length !== expected.feedbackEdges.length ||
      observedTraceFacts.feedbackAttempt?.id !== expected.feedbackAttempt?.id
    ) return MISSING;
    const baseline = await assertDom(page, expected);
    if (baseline.mismatches.length > 0) return arm === 'none' ? FAIL : MISSING;
    const candidate = candidateSha();
    if (arm !== 'none') {
      if (!(await applyMutation(page, expected, arm))) return MISSING;
      const mutated = await assertDom(page, expected);
      const targets = arm === 'edge'
        ? ['feedback_edge']
        : arm === 'attempt'
          ? ['feedback_attempt']
          : arm === 'count'
            ? ['feedback_marker_count']
            : arm === 'status'
              ? ['feedback_capture_status']
              : ['feedback_marker_count', 'feedback_edge'];
      const targeted = mutated.mismatches.filter((item) => targets.includes(item));
      const unrelated = mutated.mismatches.filter((item) => !targets.includes(item));
      if (targeted.length === 0 || unrelated.length > 0) return MISSING;
      await writePartialEvidence(`red-arms/e11-partial-${arm}.json`, {
        ...baseEvidence(candidate, actual, expected, mutated),
        marker: `E11_STRUCTURAL_RELATIONSHIP_PARTIAL_RED_${arm.toUpperCase()}`,
        status: 'FAIL',
        exit_code: FAIL,
        expected_nonzero: true,
        mutation_detected: true,
        observed_request_count: observedLifecycle.records.length,
      });
      return FAIL;
    }
    await writePartialEvidence('e11-structural-relationship-partial.json', {
      ...baseEvidence(candidate, actual, expected, baseline),
      marker: PARTIAL_PASS_MARKER,
      status: 'PASS',
      exit_code: PASS,
      observed_request_count: observedLifecycle.records.length,
    });
    return PASS;
  } catch {
    return MISSING;
  } finally {
    await browser?.close().catch(() => undefined);
    await cleanupOwnedProcess(app?.child);
    await cleanupOwnedProcess(replay?.child);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]))
  void runPartial().then((code) => { process.exitCode = code; });
