#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FAIL,
  MISSING,
  PASS,
  loadStaticReplayRecording,
  type RecordingScenario,
  type ReplayMutation,
} from './support/product-static-replay-upstream.js';

type EndpointClass = 'works' | 'runs' | 'trace';
type RequestObservation = {
  readonly method: string;
  readonly url: string;
  readonly pathname: string;
  readonly endpoint: EndpointClass | null;
  readonly allowed: boolean;
  readonly forbidden: boolean;
};

type BrowserLike = {
  newPage: () => Promise<PageLike>;
  close: () => Promise<void>;
};
type PageLike = {
  on: (event: string, listener: (...args: any[]) => void) => void;
  addInitScript: (script: () => void) => Promise<void>;
  goto: (url: string, options?: Record<string, unknown>) => Promise<unknown>;
  locator: (selector: string) => LocatorLike;
  waitForURL: (url: RegExp, options?: Record<string, unknown>) => Promise<void>;
};
type LocatorLike = {
  first: () => LocatorLike;
  click: () => Promise<void>;
  waitFor: (options?: Record<string, unknown>) => Promise<void>;
};

const appUrl = process.env.C4_APP_URL ?? 'http://127.0.0.1:3001';
const replayPort = Number(process.env.C4_REPLAY_PORT ?? 39781);
const startupTimeoutMs = Number(process.env.C4_STARTUP_TIMEOUT_MS ?? 30_000);
const replayEntry = fileURLToPath(
  new URL('./support/product-static-replay-upstream.ts', import.meta.url),
);

function scenario(): RecordingScenario {
  const value = process.env.C4_REPLAY_SCENARIO ?? 'parallel-success';
  if (value === 'parallel-success' || value === 'rework-once') return value;
  throw new Error(`invalid_scenario:${value}`);
}

function mutation(): ReplayMutation {
  const value = process.env.C4_REPLAY_MUTATION ?? 'none';
  if (value === 'none' || value === 'omit-feedback' || value === 'constant-duration')
    return value;
  throw new Error(`invalid_mutation:${value}`);
}

function candidateSha(): string {
  const value = process.env.C4_CANDIDATE_SHA ?? '';
  if (!/^[0-9a-f]{40}$/iu.test(value)) throw new Error('candidate_sha_missing_or_invalid');
  return value;
}

function evidenceDirectory(): string {
  const value = process.env.C4_EVIDENCE_DIR;
  if (!value) throw new Error('evidence_directory_missing');
  return resolve(value);
}

function classify(pathname: string): EndpointClass | null {
  if (pathname === '/api/works') return 'works';
  if (/^\/api\/works\/[^/]+\/runs\/[^/]+\/trace$/u.test(pathname)) return 'trace';
  if (/^\/api\/works\/[^/]+\/runs(?:\/[^/]+)?$/u.test(pathname)) return 'runs';
  return null;
}

function isAllowed(pathname: string): boolean {
  return pathname === '/api/works' || pathname.startsWith('/api/works/');
}

function isForbidden(pathname: string): boolean {
  return (
    /^\/api\/team-project(?:\/|$)/u.test(pathname) ||
    /^\/api\/runs(?:\/|$)/u.test(pathname) ||
    /^\/tasks(?:\/|$)/u.test(pathname) ||
    /^\/team-runs(?:\/|$)/u.test(pathname)
  );
}

function observeRequest(origin: string, requestUrl: string, method: string): RequestObservation {
  const parsed = new URL(requestUrl);
  const sameOrigin = parsed.origin === origin;
  const pathname = parsed.pathname;
  const inProductScope = sameOrigin && pathname.startsWith('/api/');
  return {
    method,
    url: requestUrl,
    pathname,
    endpoint: inProductScope ? classify(pathname) : null,
    allowed: inProductScope && isAllowed(pathname),
    forbidden: sameOrigin && isForbidden(pathname),
  };
}

function processOutput(child: ChildProcess): { readonly stdout: string[]; readonly stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  child.stdout?.on('data', (chunk: Buffer | string) => stdout.push(String(chunk)));
  child.stderr?.on('data', (chunk: Buffer | string) => stderr.push(String(chunk)));
  return { stdout, stderr };
}

async function waitForReplayReady(child: ChildProcess, output: { stdout: string[]; stderr: string[] }): Promise<string> {
  const started = Date.now();
  return new Promise((resolveReady, reject) => {
    const tick = () => {
      for (const chunk of output.stdout) {
        for (const line of chunk.split('\n')) {
          try {
            const value = JSON.parse(line) as { readonly ready?: boolean; readonly url?: string };
            if (value.ready && value.url) {
              resolveReady(value.url);
              return;
            }
          } catch {
            // The process may write a non-JSON diagnostic before readiness.
          }
        }
      }
      if (child.exitCode !== null) {
        reject(new Error(`replay_exit:${child.exitCode}`));
        return;
      }
      if (Date.now() - started >= startupTimeoutMs) {
        reject(new Error('replay_start_timeout'));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

async function waitForHttp(url: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < startupTimeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.status >= 200 && response.status < 500) return;
    } catch {
      // Keep polling until the bounded startup window expires.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`app_start_timeout:${url}`);
}

function stop(child: ChildProcess | undefined): void {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
}

async function launchReplay(): Promise<{ readonly child: ChildProcess; readonly url: string; readonly output: { stdout: string[]; stderr: string[] } }> {
  const child = spawn(process.execPath, ['--import', 'tsx', replayEntry], {
    cwd: resolve(fileURLToPath(new URL('../..', import.meta.url))),
    env: {
      ...process.env,
      C4_REPLAY_PORT: String(replayPort),
      C4_REPLAY_SCENARIO: scenario(),
      C4_REPLAY_MUTATION: mutation(),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = processOutput(child);
  const url = await waitForReplayReady(child, output);
  return { child, url, output };
}

async function launchApp(upstreamUrl: string): Promise<{ readonly child: ChildProcess; readonly output: { stdout: string[]; stderr: string[] } }> {
  const command = process.env.C4_APP_COMMAND ?? 'pnpm --filter @atomlink-ye/agent-server-web start';
  const child = spawn(command, {
    cwd: resolve(fileURLToPath(new URL('../..', import.meta.url))),
    env: {
      ...process.env,
      AGENT_SERVER_BASE_URL: upstreamUrl,
      // The replay upstream is local-only; this value is intentionally not
      // emitted into evidence or logs.
      AGENT_SERVER_SERVICE_TOKEN: process.env.C4_SERVICE_TOKEN ?? 'c4-static-replay',
    },
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = processOutput(child);
  await waitForHttp(`${appUrl}/works`);
  return { child, output };
}

async function loadChromium(): Promise<BrowserLike> {
  try {
    const playwright = (await import('playwright')) as { readonly chromium?: { launch: (options?: Record<string, unknown>) => Promise<BrowserLike> } };
    if (!playwright.chromium) throw new Error('playwright_chromium_missing');
    return await playwright.chromium.launch({ headless: true });
  } catch (error) {
    throw new Error(`browser_unavailable:${error instanceof Error ? error.message : String(error)}`);
  }
}

async function writeEvidence(name: string, payload: Record<string, unknown>): Promise<void> {
  const directory = evidenceDirectory();
  const target = resolve(directory, name);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function run(): Promise<number> {
  let replay: { child: ChildProcess; url: string; output: { stdout: string[]; stderr: string[] } } | undefined;
  let app: { child: ChildProcess; output: { stdout: string[]; stderr: string[] } } | undefined;
  let browser: BrowserLike | undefined;
  const observations: RequestObservation[] = [];
  try {
    // This check intentionally runs before any process launch. Current fa77ba9
    // doc0 recordings fail it, so this command remains an honest MISSING.
    await loadStaticReplayRecording(scenario());
    replay = await launchReplay();
    app = await launchApp(replay.url);
    browser = await loadChromium();
    const page = await browser.newPage();
    const origin = new URL(appUrl).origin;
    page.on('request', (request: { url: () => string; method: () => string }) => {
      observations.push(observeRequest(origin, request.url(), request.method()));
    });
    if (process.env.C4_RED_ARM === 'forbidden-request') {
      await page.addInitScript(() => {
        void fetch('/api/team-project');
      });
    }
    await page.goto(`${appUrl}/works`, { waitUntil: 'domcontentloaded', timeout: startupTimeoutMs });
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

    const counts = { works: 0, runs: 0, trace: 0 };
    let allowedHits = 0;
    let forbiddenHits = 0;
    for (const observation of observations) {
      if (observation.allowed) allowedHits += 1;
      if (observation.forbidden) forbiddenHits += 1;
      if (observation.endpoint) counts[observation.endpoint] += 1;
    }
    const candidate = candidateSha();
    const base = {
      candidate_sha: candidate,
      scenario: scenario(),
      command: process.argv.join(' '),
      allowed_hits: allowedHits,
      forbidden_hits: forbiddenHits,
      endpoint_hits: counts,
      requests: observations,
    };
    if (forbiddenHits > 0) {
      if (process.env.C4_RED_ARM === 'forbidden-request')
        await writeEvidence('red-arms/e10-forbidden-request.json', { ...base, status: 'FAIL', exit_code: FAIL, expected_nonzero: true });
      return FAIL;
    }
    if (allowedHits < 3 || counts.works < 1 || counts.runs < 1 || counts.trace < 1)
      return MISSING;
    await writeEvidence('e10-network.json', { ...base, status: 'PASS', exit_code: PASS });
    return PASS;
  } catch (error) {
    return MISSING;
  } finally {
    await browser?.close().catch(() => undefined);
    stop(app?.child);
    stop(replay?.child);
  }
}

void run().then((code) => {
  process.exitCode = code;
});
