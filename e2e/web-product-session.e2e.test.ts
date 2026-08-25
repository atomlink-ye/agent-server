/// <reference lib="dom" />

import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { chromium, type Browser, type Page } from 'playwright';
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
        let conversationId: string | null = null;
        let liveSnapshot: DomSnapshot | null = null;
        let replaySnapshot: DomSnapshot | null = null;
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
          const conversationsResponsePromise = page.waitForResponse(
            (response) =>
              response.request().method() === 'GET' &&
              sameOrigin(response.url()) &&
              pathname(response.url()) === '/api/conversations',
            { timeout: sendInteractionTimeout },
          );
          await page.goto('/', {
            waitUntil: 'domcontentloaded',
            timeout: sendInteractionTimeout,
          });
          expect((await conversationsResponsePromise).status()).toBe(200);

          const browserSecurity = await page.evaluate(() => ({
            origin: globalThis.location.origin,
            isSecureContext: globalThis.isSecureContext === true,
            hasRandomUUID: typeof globalThis.crypto?.randomUUID === 'function',
          }));
          if (
            browserSecurity.origin !== browserOrigin ||
            !browserSecurity.isSecureContext ||
            !browserSecurity.hasRandomUUID
          )
            throw new Error(
              `browser secure context unavailable for ${browserOrigin}: actualOrigin=${browserSecurity.origin} isSecureContext=${browserSecurity.isSecureContext} crypto.randomUUID=${browserSecurity.hasRandomUUID}`,
            );

          phase = 'select conversation';
          await page
            .waitForURL(/\/conversations\/[0-9a-f-]+/iu, {
              timeout: sendInteractionTimeout,
            })
            .catch(() => undefined);
          const newConversation = page.getByRole('button', {
            name: /New conversation/u,
          });
          await newConversation.waitFor({
            state: 'visible',
            timeout: sendInteractionTimeout,
          });
          await newConversation.click({ timeout: sendInteractionTimeout });
          const coworker = page
            .locator('.new-conversation-form')
            .getByRole('button', { name: /managed-environment-smoke/u });
          await coworker.waitFor({
            state: 'visible',
            timeout: sendInteractionTimeout,
          });
          await coworker.click({ timeout: sendInteractionTimeout });
          await page.waitForURL(/\/conversations\/[0-9a-f-]+$/iu, {
            timeout: sendInteractionTimeout,
          });
          conversationId =
            pathname(page.url()).match(
              /^\/conversations\/([0-9a-f-]+)$/iu,
            )?.[1] ?? null;
          if (!conversationId)
            throw new Error(
              `conversation was not selected: ${pathname(page.url())}`,
            );
          const header = page.locator('.chat-header h1');
          await header.waitFor({
            state: 'visible',
            timeout: sendInteractionTimeout,
          });
          expect((await header.innerText()).trim()).toBe(
            'managed-environment-smoke',
          );
          const selected = (await page.evaluate(async (id) => {
            const response = await fetch('/api/conversations', {
              credentials: 'same-origin',
            });
            const payload = (await response.json()) as {
              conversations?: Array<{
                conversation_id?: string;
                kind?: string;
                direct_agent?: { display_name?: string | null } | null;
              }>;
            };
            return payload.conversations?.find(
              (conversation) => conversation.conversation_id === id,
            );
          }, conversationId)) as
            | {
                kind?: string;
                direct_agent?: { display_name?: string | null } | null;
              }
            | undefined;
          expect(selected?.kind).toBe('direct');
          expect(selected?.direct_agent?.display_name).toBe(
            'managed-environment-smoke',
          );

          phase = 'send interaction';
          const input = page.locator('textarea#message');
          await input.waitFor({
            state: 'visible',
            timeout: sendInteractionTimeout,
          });
          const sendButton = page.getByRole('button', { name: 'Send message' });
          const messageResponsePromise = page.waitForResponse(
            (response) =>
              response.request().method() === 'POST' &&
              sameOrigin(response.url()) &&
              pathname(response.url()) ===
                `/api/conversations/${conversationId}/messages`,
            { timeout: sendInteractionTimeout },
          );
          await input.fill(prompt);
          expect(await input.inputValue()).toBe(prompt);
          await sendButton.waitFor({
            state: 'visible',
            timeout: sendInteractionTimeout,
          });
          await sendButton.click({ timeout: sendInteractionTimeout });
          const messagePost = await messageResponsePromise;
          expect(messagePost.status()).toBe(202);

          phase = 'live response';
          await waitForSettledTurn(page, marker);
          liveSnapshot = await captureSnapshot(page);
          assertTranscriptInvariants(liveSnapshot);
          expect(
            liveSnapshot.assistantTexts.some((text) => text.includes(marker)),
          ).toBe(true);
          await saveArtifactScreenshot(
            page,
            'web-product-session-live-desktop.png',
            { fullPage: true },
          );

          phase = 'reload/replay';
          await page.reload({
            waitUntil: 'domcontentloaded',
            timeout: sendInteractionTimeout,
          });
          await waitForSettledTurn(page, marker);
          replaySnapshot = await captureSnapshot(page);
          assertTranscriptInvariants(replaySnapshot);
          expect(replaySnapshot.assistantTexts).toEqual(
            liveSnapshot.assistantTexts,
          );
          expect(replaySnapshot.transcript).toEqual(liveSnapshot.transcript);
          await saveArtifactScreenshot(
            page,
            'web-product-session-replay-desktop.png',
            { fullPage: true },
          );

          if (artifactDir) {
            await mkdir(artifactDir, { recursive: true });
            await writeFile(
              join(artifactDir, 'web-product-session.evidence.json'),
              `${JSON.stringify(
                {
                  ok: true,
                  provider: providerEnv!,
                  model: modelEnv!,
                  conversation_id: conversationId,
                  marker,
                  live: liveSnapshot,
                  replay: replaySnapshot,
                  dom_identical: true,
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
            await page
              .screenshot({
                path: join(
                  artifactDir,
                  `web-product-session-${conversationId ?? 'unknown'}.png`,
                ),
                fullPage: true,
              })
              .catch(() => undefined);
          }
          throw new Error(
            [
              `web ProductSession E2E failed during ${phase}`,
              `provider=${providerEnv}`,
              `model=${modelEnv}`,
              `conversationId=${conversationId ?? '<unknown>'}`,
              `reason=${redactSecrets(error instanceof Error ? error.message : 'unknown failure').slice(0, 240)}`,
            ].join(' '),
          );
        }
      },
      testTimeout,
    );
  },
);

type DomSnapshot = {
  transcript: Array<{ role: 'user' | 'assistant'; text: string }>;
  assistantTexts: string[];
};

function sameOrigin(url: string): boolean {
  return Boolean(baseUrl) && new URL(url).origin === new URL(baseUrl!).origin;
}

function pathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
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
    for (const element of document.querySelectorAll('article.chat-message')) {
      const author = element.getAttribute('data-author-type');
      const role =
        author === 'agent_definition'
          ? 'assistant'
          : author === 'principal'
            ? 'user'
            : null;
      if (!role) continue;
      transcript.push({
        role,
        text: (element.querySelector('p')?.textContent ?? '').trim(),
      });
    }
    return {
      transcript,
      assistantTexts: transcript
        .filter((entry) => entry.role === 'assistant')
        .map((entry) => entry.text),
    };
  });
}

async function waitForSettledTurn(
  page: Page,
  marker: string,
  timeout = testTimeout,
): Promise<void> {
  await page.waitForFunction(
    (expectedMarker) => {
      const messages: Array<{ role: string; text: string }> = [];
      for (const element of document.querySelectorAll('article.chat-message')) {
        const author = element.getAttribute('data-author-type');
        const role =
          author === 'agent_definition'
            ? 'assistant'
            : author === 'principal'
              ? 'user'
              : null;
        if (!role) continue;
        messages.push({
          role,
          text: (element.querySelector('p')?.textContent ?? '').trim(),
        });
      }
      const sending = Boolean(
        document.querySelector('button[aria-label="Sending message"]'),
      );
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
        !sending
      );
    },
    marker,
    { timeout },
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
}

function redactSecrets(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]+/gu, '<redacted>')
    .replace(/Bearer\s+\S+/gu, 'Bearer <redacted>');
}
