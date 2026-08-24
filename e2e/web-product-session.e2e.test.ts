/// <reference lib="dom" />

import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { chromium, type Browser, type Page, type Response } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';

const baseUrlEnv = process.env.WEB_E2E_BASE_URL;
const providerEnv = process.env.WEB_E2E_PROVIDER;
const modelEnv = process.env.WEB_E2E_MODEL;
const resolveHost = process.env.WEB_E2E_RESOLVE_HOST ?? 'web';
const configuredEnvironmentCount = [baseUrlEnv, providerEnv, modelEnv].filter(
  (value) => value !== undefined,
).length;
if (configuredEnvironmentCount !== 0 && configuredEnvironmentCount !== 3) {
  throw new Error(
    'WEB_E2E_BASE_URL, WEB_E2E_PROVIDER, and WEB_E2E_MODEL must be set together',
  );
}
const baseUrl = baseUrlEnv?.replace(/\/$/u, '');
const artifactDir = process.env.WEB_E2E_ARTIFACT_DIR;
const testTimeout = 10 * 60 * 1000;
const sendInteractionTimeout = 60 * 1000;

let browser: Browser | undefined;

describe.skipIf(baseUrlEnv === undefined)(
  'web ProductSession live/replay E2E',
  () => {
    afterEach(async () => {
      await browser?.close();
      browser = undefined;
    });

    it(
      'renders one marker turn and preserves live/replayed events and DOM exactly',
      async () => {
        const marker = `WEB_PRODUCT_SESSION_E2E_${randomUUID()}`;
        const prompt = `Reply with exactly this marker and no other text: ${marker}`;
        let page: Page | undefined;
        let sessionId: string | null = null;
        let postSessionId: string | null = null;
        let runId: string | null = null;
        let liveEvents: RunEvent[] | null = null;
        let replayEvents: RunEvent[] | null = null;
        let liveSnapshot: DomSnapshot | null = null;
        let replaySnapshot: DomSnapshot | null = null;
        let comparisonLeft: unknown;
        let comparisonRight: unknown;
        let rawEventsDiffSummary: unknown = null;
        let phase = 'open';

        try {
          const browserOrigin = new URL(baseUrl!).origin;
          const browserHostname = new URL(baseUrl!).hostname;
          if (!browserHostname.endsWith('.localhost'))
            throw new Error(
              `WEB_E2E_BASE_URL must use a trustworthy .localhost hostname: ${browserOrigin}`,
            );
          const { address: webAddress } = await lookup(resolveHost, {
            family: 4,
          });
          browser = await chromium.launch({
            headless: true,
            args: [
              `--host-resolver-rules=MAP ${browserHostname} ${webAddress}`,
            ],
          });
          const context = await browser.newContext({ baseURL: baseUrl! });
          page = await context.newPage();

          phase = 'initial page';
          const sessionResponsePromise = page.waitForResponse(
            (response) =>
              response.request().method() === 'GET' &&
              sameOrigin(response.url()) &&
              sessionPath(response.url()) === '/api/session',
            { timeout: testTimeout },
          );
          await page.goto('/', {
            waitUntil: 'domcontentloaded',
            timeout: testTimeout,
          });
          const sessionResponse = await sessionResponsePromise;
          expect(sessionResponse.status()).toBe(200);

          const newChatButton = page.getByRole('button', { name: /New Chat/u });
          await newChatButton.waitFor({
            state: 'visible',
            timeout: sendInteractionTimeout,
          });
          const newChatResponsePromise = page.waitForResponse(
            (response) =>
              response.request().method() === 'POST' &&
              sameOrigin(response.url()) &&
              sessionPath(response.url()) === '/api/chats',
            { timeout: sendInteractionTimeout },
          );
          await newChatButton.click({ timeout: sendInteractionTimeout });
          const newChatResponse = await newChatResponsePromise;
          expect(newChatResponse.status()).toBe(201);
          const newChatBody = (await newChatResponse.json()) as {
            session?: { session_id?: string };
          };
          sessionId = newChatBody.session?.session_id ?? null;
          if (!sessionId)
            throw new Error('new chat response had no session id');

          const input = page.locator('textarea[aria-label="Message"]');
          await page.waitForFunction(
            () => {
              const composerInput = document.querySelector(
                'textarea[aria-label="Message"]',
              ) as { disabled?: boolean } | null;
              const newChat = document.querySelector(
                'button.new-chat-button',
              ) as { disabled?: boolean } | null;
              return Boolean(
                composerInput &&
                !composerInput.disabled &&
                newChat &&
                !newChat.disabled,
              );
            },
            undefined,
            { timeout: sendInteractionTimeout },
          );
          await input.waitFor({
            state: 'visible',
            timeout: sendInteractionTimeout,
          });
          const browserSecurity = await page.evaluate(() => {
            return {
              origin: globalThis.location.origin,
              isSecureContext: globalThis.isSecureContext === true,
              hasRandomUUID:
                typeof globalThis.crypto?.randomUUID === 'function',
            };
          });
          if (
            browserSecurity.origin !== browserOrigin ||
            !browserSecurity.isSecureContext ||
            !browserSecurity.hasRandomUUID
          )
            throw new Error(
              `browser secure context unavailable for ${browserOrigin}: actualOrigin=${browserSecurity.origin} isSecureContext=${browserSecurity.isSecureContext} crypto.randomUUID=${browserSecurity.hasRandomUUID}`,
            );
          const sendButton = page.getByRole('button', { name: /^Send/u });
          const liveResponsePromise = page.waitForResponse(
            (response) =>
              response.request().method() === 'GET' &&
              sameOrigin(response.url()) &&
              /^\/api\/runs\/[^/]+\/events$/u.test(
                eventStreamPath(response.url()),
              ) &&
              /text\/event-stream/iu.test(
                response.headers()['content-type'] ?? '',
              ),
            { timeout: testTimeout },
          );
          void liveResponsePromise.catch(() => undefined);
          const messageRequestPromise = page.waitForRequest(
            (request) =>
              request.method() === 'POST' &&
              sameOrigin(request.url()) &&
              /^\/api\/sessions\/[^/]+\/messages$/u.test(
                sessionPath(request.url()),
              ),
            { timeout: sendInteractionTimeout },
          );
          const messageResponsePromise = page.waitForResponse(
            (response) =>
              response.request().method() === 'POST' &&
              sameOrigin(response.url()) &&
              /^\/api\/sessions\/[^/]+\/messages$/u.test(
                sessionPath(response.url()),
              ),
            { timeout: sendInteractionTimeout },
          );
          phase = 'send interaction';
          await input.fill(prompt);
          expect(await input.inputValue()).toBe(prompt);
          await sendButton.waitFor({
            state: 'visible',
            timeout: sendInteractionTimeout,
          });
          await page.waitForFunction(
            () => {
              const button = document.querySelector(
                'form.composer button[type="submit"]',
              ) as { disabled?: boolean } | null;
              return Boolean(button && !button.disabled);
            },
            undefined,
            { timeout: sendInteractionTimeout },
          );
          await sendButton.click({ timeout: sendInteractionTimeout });
          const [messageRequest, messagePost] = await Promise.all([
            messageRequestPromise,
            messageResponsePromise,
          ]);
          expect(messageRequest.method()).toBe('POST');
          expect(messagePost.status()).toBe(202);
          postSessionId = sessionIdFromMessageUrl(messagePost.url());
          expect(postSessionId).toBe(sessionId);

          phase = 'live response';
          await waitForSettledTurn(page, marker);

          const liveCapture = await captureResponseBody(
            liveResponsePromise,
            'live events',
          );
          runId = runIdFromLiveUrl(liveCapture.response.url());
          if (!runId)
            throw new Error('live events URL did not contain a full run id');
          liveEvents = parseSseEvents(liveCapture.body, 'live events');
          assertCanonicalCreatedAt(liveEvents, 'live events');
          expect(hasToolEvent(liveEvents)).toBe(false);

          await page.waitForTimeout(750);
          await saveArtifactScreenshot(
            page,
            'web-product-session-live-desktop.png',
            {
              fullPage: true,
            },
          );
          liveSnapshot = await captureSnapshot(page);
          assertTranscriptInvariants(liveSnapshot);
          expect(
            liveSnapshot.assistantTexts.some((text) => text.includes(marker)),
          ).toBe(true);

          phase = 'reload/replay';
          const expectedSession = sessionId;
          const expectedRun = runId;
          const replayResponsePromise = page.waitForResponse(
            (response) => {
              const match = eventStreamPath(response.url()).match(
                /^\/api\/chats\/([^/]+)\/runs\/([^/]+)\/events$/u,
              );
              return (
                response.request().method() === 'GET' &&
                sameOrigin(response.url()) &&
                match?.[1] === expectedSession &&
                match?.[2] === expectedRun
              );
            },
            { timeout: testTimeout },
          );
          void replayResponsePromise.catch(() => undefined);
          await page.reload({
            waitUntil: 'domcontentloaded',
            timeout: testTimeout,
          });
          await waitForSettledTurn(page, marker);

          const replayCapture = await captureResponseBody(
            replayResponsePromise,
            'replay events',
          );
          const replayBody = JSON.parse(
            replayCapture.body.toString('utf8'),
          ) as {
            events?: RunEvent[];
          };
          replayEvents = replayBody.events ?? null;
          assertCanonicalCreatedAt(replayEvents, 'replay events');

          await page.waitForTimeout(750);
          replaySnapshot = await captureSnapshot(page);
          assertTranscriptInvariants(replaySnapshot);
          rawEventsDiffSummary = rawEventsDiff(liveEvents, replayEvents);
          if (rawEventsDiffSummary)
            throw new Error(
              `raw events differs between live and replay: ${JSON.stringify(rawEventsDiffSummary)}`,
            );
          expect(liveEvents.map((event) => JSON.stringify(event))).toEqual(
            replayEvents.map((event) => JSON.stringify(event)),
          );

          comparisonLeft = liveSnapshot;
          comparisonRight = replaySnapshot;
          expect(replaySnapshot).toEqual(liveSnapshot);
          expect(replaySnapshot.assistantTexts).toHaveLength(1);
          expect(hasToolEvent(replayEvents)).toBe(false);

          await saveArtifactScreenshot(
            page,
            'web-product-session-replay-desktop.png',
            { fullPage: true },
          );
          if (artifactDir) {
            await page.setViewportSize({ width: 390, height: 600 });
            await page.evaluate(() => {
              window.scrollTo(0, document.documentElement.scrollHeight);
            });
            await saveArtifactScreenshot(
              page,
              'web-product-session-mobile-bottom.png',
            );
          }

          if (artifactDir) {
            await mkdir(artifactDir, { recursive: true });
            await writeFile(
              join(artifactDir, 'web-product-session.evidence.json'),
              `${JSON.stringify(
                {
                  ok: true,
                  provider: providerEnv!,
                  model: modelEnv!,
                  session_id: expectedSession,
                  post_session_id: postSessionId,
                  run_id: expectedRun,
                  live: {
                    url: safeUrl(liveCapture.response.url()),
                    same_session: true,
                    same_run: true,
                    events: liveEvents,
                    canonical_created_at: true,
                  },
                  replay: {
                    url: safeUrl(replayCapture.response.url()),
                    same_session: true,
                    same_run: true,
                    events: replayEvents,
                    canonical_created_at: true,
                  },
                  raw_events_identical: true,
                  dom_identical: true,
                  marker,
                },
                null,
                2,
              )}\n`,
              'utf8',
            );
          }
        } catch (error) {
          if (artifactDir && page) {
            await mkdir(artifactDir, { recursive: true });
            const runPart = runId
              ? runId.replace(/[^a-zA-Z0-9_-]/gu, '_')
              : 'unknown-run';
            await page
              .screenshot({
                path: join(artifactDir, `web-product-session-${runPart}.png`),
                fullPage: true,
              })
              .catch(() => undefined);
          }
          const firstDifference = describeDifference(
            comparisonLeft,
            comparisonRight,
          );
          throw new Error(
            [
              `web ProductSession E2E failed during ${phase}`,
              `provider=${providerEnv}`,
              `model=${modelEnv}`,
              `sessionId=${sessionId ?? '<unknown>'}`,
              `runId=${runId ?? '<unknown>'}`,
              `reason=${redactSecrets(error instanceof Error ? error.message : 'unknown failure').slice(0, 240)}`,
              `firstDifference=${firstDifference}`,
            ].join(' '),
          );
        }
      },
      testTimeout,
    );
  },
);

type RunEvent = {
  sequence: number;
  type: string;
  created_at: string;
  run_id?: string;
  payload?: unknown;
};

type DomSnapshot = {
  transcript: Array<{ role: 'user' | 'assistant'; text: string }>;
  activity: Array<{ class: string; text: string }>;
  assistantTexts: string[];
};

function sameOrigin(url: string): boolean {
  return Boolean(baseUrl) && new URL(url).origin === new URL(baseUrl!).origin;
}

function safeUrl(value: string): string {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '[invalid-url]';
  }
}

function sessionPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

function sessionIdFromMessageUrl(url: string): string | null {
  const match = sessionPath(url).match(/^\/api\/sessions\/([^/]+)\/messages$/u);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function eventStreamPath(url: string): string {
  return sessionPath(url);
}

function runIdFromLiveUrl(url: string): string | null {
  const match = eventStreamPath(url).match(/^\/api\/runs\/([^/]+)\/events$/u);
  return match ? decodeURIComponent(match[1]!) : null;
}

async function captureResponseBody(
  responsePromise: Promise<Response>,
  label: string,
): Promise<{ response: Response; body: Buffer }> {
  const response = await responsePromise;
  const body = await response.body();
  if (!body) throw new Error(`${label} response.body() unavailable`);
  return { response, body };
}

async function saveArtifactScreenshot(
  page: Page,
  filename: string,
  options: { fullPage?: boolean } = {},
): Promise<void> {
  if (!artifactDir) return;
  await mkdir(artifactDir, { recursive: true });
  await page.screenshot({ path: join(artifactDir, filename), ...options });
}

async function captureSnapshot(page: Page): Promise<DomSnapshot> {
  return page.evaluate(() => {
    const transcript: Array<{ role: 'user' | 'assistant'; text: string }> = [];
    for (const turn of document.querySelectorAll('.turn')) {
      for (const element of turn.querySelectorAll(':scope > .message')) {
        const role = element.classList.contains('assistant')
          ? 'assistant'
          : element.classList.contains('user')
            ? 'user'
            : null;
        if (!role) continue;
        const surface = element.querySelector(
          '.assistant-surface, .message-surface',
        );
        transcript.push({
          role,
          text: (surface?.textContent ?? '').trim(),
        });
      }
    }
    const activity: Array<{ class: string; text: string }> = [];
    for (const list of document.querySelectorAll(
      "[aria-label='Execution activity'] .activity-list",
    )) {
      for (const child of Array.from(list.children)) {
        activity.push({
          class: typeof child.className === 'string' ? child.className : '',
          text: (child.textContent ?? '').trim(),
        });
      }
    }
    const assistantTexts = transcript
      .filter((entry) => entry.role === 'assistant')
      .map((entry) => entry.text);
    return { transcript, activity, assistantTexts };
  });
}

async function waitForSettledTurn(
  page: Page,
  marker: string,
  timeout = testTimeout,
): Promise<void> {
  await page.waitForFunction(
    (expectedMarker) => {
      const status =
        document.querySelector('.header-state .status')?.textContent?.trim() ??
        '';
      const messages: Array<{ role: string; text: string }> = [];
      for (const turn of document.querySelectorAll('.turn')) {
        for (const element of turn.querySelectorAll(':scope > .message')) {
          const role = element.classList.contains('assistant')
            ? 'assistant'
            : element.classList.contains('user')
              ? 'user'
              : null;
          if (!role) continue;
          const surface = element.querySelector(
            '.assistant-surface, .message-surface',
          );
          messages.push({ role, text: (surface?.textContent ?? '').trim() });
        }
      }
      return (
        messages.some(
          (message) =>
            message.role === 'user' && message.text.includes(expectedMarker),
        ) &&
        messages.some(
          (message) =>
            message.role === 'assistant' &&
            message.text.includes(expectedMarker),
        ) &&
        !/running|working/iu.test(status)
      );
    },
    marker,
    { timeout },
  );
}

function parseSseEvents(body: Buffer, label: string): RunEvent[] {
  const events: RunEvent[] = [];
  for (const block of body.toString('utf8').split(/\r?\n\r?\n/u)) {
    const data = block
      .split(/\r?\n/u)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trimStart())
      .join('\n');
    if (!data) continue;
    try {
      events.push(JSON.parse(data) as RunEvent);
    } catch (error) {
      throw new Error(`${label} contains invalid SSE JSON: ${error}`);
    }
  }
  return events;
}

function assertCanonicalCreatedAt(
  events: RunEvent[] | null,
  label: string,
): asserts events is RunEvent[] {
  if (!events?.length) throw new Error(`${label} contains no raw events`);
  for (const [index, event] of events.entries()) {
    if (!isCanonicalCreatedAt(event.created_at))
      throw new Error(`${label} event ${index} has non-canonical created_at`);
  }
}

function isCanonicalCreatedAt(value: string): boolean {
  if (
    value.length !== 24 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  )
    return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function hasToolEvent(events: RunEvent[]): boolean {
  return events.some(
    (event) => isRecord(event.payload) && event.payload.kind === 'tool_status',
  );
}

function assertTranscriptInvariants(snapshot: DomSnapshot): void {
  for (let index = 1; index < snapshot.transcript.length; index += 1) {
    const previous = snapshot.transcript[index - 1]!;
    const current = snapshot.transcript[index]!;
    if (previous.role === current.role && previous.text === current.text)
      throw new Error(
        `adjacent duplicate transcript messages at index ${index}`,
      );
  }
  for (let index = 1; index < snapshot.assistantTexts.length; index += 1) {
    const previous = snapshot.assistantTexts[index - 1]!;
    const current = snapshot.assistantTexts[index]!;
    if (previous === current)
      throw new Error(`adjacent duplicate assistant text at index ${index}`);
    if (current.length > previous.length && current.startsWith(previous))
      throw new Error(
        `assistant text at index ${index} repeats the preceding text as a prefix`,
      );
  }
}

function rawEventsDiff(
  liveEvents: RunEvent[] | null,
  replayEvents: RunEvent[] | null,
): unknown {
  if (!liveEvents || !replayEvents)
    return { kind: 'not-arrays', live: liveEvents, replay: replayEvents };
  const count = Math.min(liveEvents.length, replayEvents.length);
  for (let index = 0; index < count; index += 1) {
    if (
      JSON.stringify(liveEvents[index]) === JSON.stringify(replayEvents[index])
    )
      continue;
    return {
      kind: 'event',
      index,
      live: liveEvents[index],
      replay: replayEvents[index],
    };
  }
  return liveEvents.length === replayEvents.length
    ? null
    : {
        kind: 'length',
        index: count,
        liveLength: liveEvents.length,
        replayLength: replayEvents.length,
      };
}

function describeDifference(left: unknown, right: unknown): string {
  const leftText = JSON.stringify(left);
  const rightText = JSON.stringify(right);
  if (leftText === rightText) return 'none';
  const a = leftText ?? '<undefined>';
  const b = rightText ?? '<undefined>';
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index])
    index += 1;
  return `offset=${index} left=${JSON.stringify(a.slice(index, index + 80))} right=${JSON.stringify(b.slice(index, index + 80))}`;
}

function redactSecrets(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]+/gu, '<redacted>')
    .replace(/Bearer\s+\S+/gu, 'Bearer <redacted>');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
