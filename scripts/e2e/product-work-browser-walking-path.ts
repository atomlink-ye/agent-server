#!/usr/bin/env node

import type { ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanupOwnedProcess } from './support/owned-process-cleanup.mjs';
import {
  loadStaticReplayRecording,
  type RecordingScenario,
} from './support/product-static-replay-upstream.js';
import {
  launchApp,
  launchReplay,
  loadChromium,
  type BrowserLike,
} from './product-run-trace-network.js';

const PASS = 0;
const FAIL = 1;
const MISSING = 2;
const machine = 'PRODUCT_WORK_BROWSER_WALKING_PATH';
const appUrl = process.env.C4_APP_URL ?? 'http://127.0.0.1:3001';
const timeout = Number(process.env.C4_STARTUP_TIMEOUT_MS ?? 30_000);

function scenario(): RecordingScenario {
  const value = process.env.C4_REPLAY_SCENARIO;
  if (value === 'parallel-success' || value === 'rework-once') return value;
  throw new Error('walking_path_scenario_missing_or_invalid');
}

function evidenceDirectory(): string {
  const value = process.env.C4_WALKING_EVIDENCE_DIR;
  if (!value) throw new Error('walking_path_evidence_directory_missing');
  return resolve(value);
}

function sameStrings(actual: readonly string[], expected: readonly string[]): boolean {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

async function run(): Promise<number> {
  let replay: { readonly child: ChildProcess; readonly url: string; readonly output: { readonly stdout: string[]; readonly stderr: string[] } } | undefined;
  let app: { readonly child: ChildProcess; readonly output: { readonly stdout: string[]; readonly stderr: string[] } } | undefined;
  let browser: BrowserLike | undefined;
  const selected = scenario();
  const output = evidenceDirectory();
  const log: Record<string, unknown> = {
    machine,
    scenario: selected,
    started_at: new Date().toISOString(),
  };
  try {
    process.env.C4_WALKING_PATH_DIRECT_DEMO = '1';
    const recording = await loadStaticReplayRecording(selected);
    replay = await launchReplay();
    app = await launchApp(replay.url);
    browser = await loadChromium();
    const page = (await browser.newPage()) as any;

    await page.goto(`${appUrl}/works`, {
      waitUntil: 'domcontentloaded',
      timeout,
    });
    await page.getByText('My Work', { exact: true }).first().waitFor({
      state: 'visible',
      timeout,
    });
    const workLink = page.getByRole('link', {
      name: recording.work.title,
      exact: true,
    });
    if ((await workLink.count()) !== 1) return FAIL;
    if ((await workLink.getAttribute('href')) !== `/works/${recording.work.id}`)
      return FAIL;
    await Promise.all([
      page.waitForURL(/\/works\/[^/]+$/u, { timeout }),
      workLink.click(),
    ]);

    await page.locator('[data-testid="work-detail-shell"]').waitFor({
      state: 'visible',
      timeout,
    });
    const outcome = page.locator('[data-testid="work-outcome"]');
    await outcome.waitFor({ state: 'visible', timeout });
    const outcomeText = (await outcome.textContent()) ?? '';
    const expectedOutcome = recording.run.work_run.result_summary;
    if (
      expectedOutcome === null
        ? !outcomeText.includes('Final outcome unavailable') ||
          !outcomeText.includes('not captured')
        : !outcomeText.includes(expectedOutcome)
    )
      return FAIL;

    const visibleActors = await page.locator('.run-trace__lane-name').allTextContents();
    const expectedActors = recording.trace.actors.map(
      (actor) => actor.name ?? 'Name not captured',
    );
    if (!sameStrings(visibleActors, expectedActors)) return FAIL;

    const visibleItems = await page.locator('.run-trace__item-name').allTextContents();
    const expectedItems = recording.trace.work_items.map((item) => item.subject);
    if (!sameStrings(visibleItems, expectedItems)) return FAIL;

    const expectedAttemptCount = recording.trace.work_items.reduce(
      (count, item) => count + item.attempts.length,
      0,
    );
    const attemptCount = await page.locator('[data-testid="trace-attempt"]').count();
    if (attemptCount !== expectedAttemptCount) return FAIL;

    const feedbackEdges = recording.trace.edges.filter(
      (edge) => edge.kind === 'feedback',
    );
    const markers = page.locator('[aria-label="Recorded feedback relation"]');
    if ((await markers.count()) !== feedbackEdges.length) return FAIL;
    for (let index = 0; index < feedbackEdges.length; index += 1) {
      const edge = feedbackEdges[index];
      if (edge?.attempt_id === null) return MISSING;
      if ((await markers.nth(index).getAttribute('data-attempt-id')) !== edge?.attempt_id)
        return FAIL;
    }

    const coverage =
      (await page.locator('[data-testid="trace-coverage-disclosure"]').textContent()) ??
      '';
    if (
      feedbackEdges.length > 0 &&
      (!coverage.includes(`${feedbackEdges.length} recorded feedback edge`) ||
        !coverage.includes('relation geometry is unavailable'))
    )
      return FAIL;

    await mkdir(output, { recursive: true });
    const screenshot = resolve(output, `${selected}.png`);
    await page.screenshot({ fullPage: true, path: screenshot });
    Object.assign(log, {
      status: 'PASS',
      exit_code: PASS,
      completed_at: new Date().toISOString(),
      work_id: recording.work.id,
      work_title: recording.work.title,
      outcome:
        expectedOutcome ?? 'Final outcome unavailable — not captured for this run.',
      actor_count: visibleActors.length,
      work_item_count: visibleItems.length,
      attempt_count: attemptCount,
      feedback_edge_count: feedbackEdges.length,
      feedback_source_attempt_ids: feedbackEdges.map((edge) => edge.attempt_id),
      screenshot,
      replay_stdout: replay.output.stdout,
      replay_stderr: replay.output.stderr,
      app_stdout: app.output.stdout,
      app_stderr: app.output.stderr,
    });
    await writeFile(
      resolve(output, `${selected}.json`),
      `${JSON.stringify(log, null, 2)}\n`,
      'utf8',
    );
    return PASS;
  } catch (error) {
    await mkdir(output, { recursive: true }).catch(() => undefined);
    Object.assign(log, {
      status: 'MISSING',
      exit_code: MISSING,
      completed_at: new Date().toISOString(),
      reason: error instanceof Error ? error.message : String(error),
      replay_stdout: replay?.output.stdout ?? [],
      replay_stderr: replay?.output.stderr ?? [],
      app_stdout: app?.output.stdout ?? [],
      app_stderr: app?.output.stderr ?? [],
    });
    await writeFile(
      resolve(output, `${selected}.json`),
      `${JSON.stringify(log, null, 2)}\n`,
      'utf8',
    ).catch(() => undefined);
    return MISSING;
  } finally {
    await browser?.close().catch(() => undefined);
    await cleanupOwnedProcess(app?.child);
    await cleanupOwnedProcess(replay?.child);
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
)
  void run().then((code) => {
    process.exitCode = code;
  });
