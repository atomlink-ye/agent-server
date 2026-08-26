import { randomUUID } from 'node:crypto';

import { chromium, type Browser, type Page } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';

const configuredBaseUrl = process.env.WEB_E2E_BASE_URL?.trim();
if (!configuredBaseUrl)
  throw new Error(
    'WEB_E2E_BASE_URL is required for the Golden Path browser canary.',
  );
if (process.env.WEB_BOOTSTRAP_EMPTY_PRODUCT !== '1')
  throw new Error(
    'WEB_BOOTSTRAP_EMPTY_PRODUCT=1 is required for the Golden Path browser canary.',
  );
const parsedBaseUrl = new URL(configuredBaseUrl);
if (!parsedBaseUrl.hostname.endsWith('.localhost'))
  throw new Error(
    'WEB_E2E_BASE_URL must use a trustworthy .localhost hostname for the Golden Path browser canary.',
  );
const baseUrl = configuredBaseUrl.replace(/\/$/u, '');
const testTimeout = 8 * 60 * 1000;
let browser: Browser | undefined;

describe('web Product Golden Path', () => {
  afterEach(async () => {
    await browser?.close();
    browser = undefined;
  });

  it(
    'creates a Coworker, teaches a Capability, and starts Work through the UI',
    async () => {
      const suffix = randomUUID().slice(0, 8);
      const coworkerName = `Golden Path ${suffix}`;
      const capabilityName = `Competitor Brief ${suffix}`;
      let conversationId: string;
      const browserOrigin = new URL(baseUrl!).origin;
      browser = await chromium.launch({ headless: true });
      const page = await (
        await browser.newContext({ baseURL: baseUrl! })
      ).newPage();

      await page.goto('/agents', {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      await page
        .getByText('No Coworkers yet.', { exact: true })
        .waitFor({ state: 'visible', timeout: 60_000 });
      await page
        .getByRole('button', { name: 'Create your first Coworker' })
        .click();
      await page.getByPlaceholder('Maya').fill(coworkerName);
      await page.getByPlaceholder('Research Analyst').fill('Research Analyst');
      await page
        .getByPlaceholder(/Research competitors, track market changes/u)
        .fill('Research competitors and summarize evidence.');
      await page
        .getByPlaceholder(/Be thorough, concise/u)
        .fill('Be concise and cite evidence.');
      const createResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).origin === browserOrigin &&
          new URL(response.url()).pathname === '/api/agents',
      );
      await page.getByRole('button', { name: 'Create & Chat' }).click();
      expect((await createResponse).status()).toBe(201);
      await page.waitForURL(/\/conversations\/[^/]+$/u, { timeout: 60_000 });
      conversationId =
        page.url().match(/\/conversations\/([^/]+)$/u)?.[1] ?? '';
      if (!conversationId)
        throw new Error(
          'Conversation id was not returned after Coworker creation.',
        );
      await page.locator('.chat-header h1').waitFor({ state: 'visible' });
      expect((await page.locator('.chat-header h1').innerText()).trim()).toBe(
        coworkerName,
      );
      const chatMarker = `GOLDEN_PATH_CHAT_${suffix}`;
      const messageInput = page.locator('textarea#message');
      await messageInput.fill(
        `Reply with exactly this marker and no other text: ${chatMarker}`,
      );
      const messageResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).origin === browserOrigin &&
          new URL(response.url()).pathname ===
            `/api/conversations/${conversationId}/messages`,
      );
      await page.getByRole('button', { name: 'Send message' }).click();
      expect((await messageResponse).status()).toBe(202);
      await page.waitForFunction(
        (marker) => {
          const assistant = [
            ...document.querySelectorAll('article.chat-message'),
          ]
            .filter(
              (element) =>
                element.getAttribute('data-author-type') === 'agent_definition',
            )
            .some((element) =>
              (element.querySelector('p')?.textContent ?? '').includes(marker),
            );
          return (
            assistant &&
            !document.querySelector('button[aria-label="Sending message"]')
          );
        },
        chatMarker,
        { timeout: 5 * 60 * 1000 },
      );

      await page.getByRole('button', { name: 'Agents' }).click();
      await page
        .getByRole('heading', { name: coworkerName })
        .waitFor({ state: 'visible', timeout: 60_000 });
      const agentId = page.url().match(/\/agents\/([^/?#]+)$/u)?.[1] ?? null;
      if (!agentId)
        throw new Error('Coworker profile URL did not include an id.');
      await page.getByRole('button', { name: '+ Add capability' }).click();
      await page.getByPlaceholder('Competitor Research').fill(capabilityName);
      await page
        .getByPlaceholder(/Research a company’s major competitors/u)
        .fill('Compare a company with its major competitors.');
      await page.getByRole('button', { name: '+ Add input' }).click();
      const inputRow = page.locator('.agents-input-row').last();
      await inputRow.getByLabel('Input label').fill('Company');
      await inputRow.getByLabel('Input key').fill('company');
      await page.getByRole('button', { name: 'Preview plan' }).click();
      await page.getByText(/Ready to save/u).waitFor({
        state: 'visible',
        timeout: 60_000,
      });
      const bindingResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).origin === browserOrigin &&
          new URL(response.url()).pathname ===
            `/api/agents/${agentId}/capabilities`,
      );
      await page.getByRole('button', { name: 'Save capability' }).click();
      const savedBinding = await bindingResponse;
      if (!savedBinding.ok()) {
        throw new Error(
          `Capability binding failed (${savedBinding.status()}): ${await boundedErrorBody(savedBinding)}`,
        );
      }
      expect(savedBinding.status()).toBe(200);
      await page
        .getByText('Capability saved to this Coworker’s Work Catalog.')
        .waitFor({ state: 'visible', timeout: 60_000 });
      await page.getByRole('button', { name: 'Cancel' }).click();
      await page
        .getByRole('heading', { name: capabilityName })
        .waitFor({ state: 'visible', timeout: 60_000 });

      await page.goto(`/conversations/${conversationId}`, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      await page.locator('.chat-header h1').waitFor({ state: 'visible' });
      await page.getByRole('button', { name: 'Work' }).click();
      await page.waitForURL(
        new RegExp(`/work\\?from_conversation=${conversationId}`, 'u'),
        { timeout: 60_000 },
      );
      await page.getByTestId('new-work-cta').click();
      await page.locator('#work-coworker').waitFor({ state: 'visible' });
      await page.locator('#work-capability').waitFor({ state: 'visible' });
      const company = page.locator('#work-input-company');
      await company.waitFor({ state: 'visible', timeout: 60_000 });
      await company.fill('Acme');
      const workCreateResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/api/works',
      );
      const runRequest = page.waitForRequest(
        (request) =>
          request.method() === 'POST' &&
          /\/api\/works\/[0-9a-f-]+\/runs$/iu.test(
            new URL(request.url()).pathname,
          ),
      );
      const runResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          /\/api\/works\/[0-9a-f-]+\/runs$/iu.test(
            new URL(response.url()).pathname,
          ),
      );
      await page.getByRole('button', { name: 'Start Work' }).click();
      const createdWorkResponse = await workCreateResponse;
      expect(createdWorkResponse.status()).toBe(201);
      const submittedRunRequest = await runRequest;
      expect(JSON.parse(submittedRunRequest.postData() ?? '{}')).toMatchObject({
        trigger_kind: 'manual',
        input: { company: 'Acme' },
      });
      expect((await runResponse).status()).toBe(202);
      await page.waitForURL(/\/work\/[0-9a-f-]+\?run=[0-9a-f-]+/iu, {
        timeout: 60_000,
      });
      await page.getByText(/Product Work\/Run reads/u).waitFor({
        state: 'visible',
        timeout: 60_000,
      });

      const runMatch = page
        .url()
        .match(/\/work\/([0-9a-f-]+)\?run=([0-9a-f-]+)/iu);
      if (!runMatch)
        throw new Error('The started Work URL did not include a Run.');
      await waitForObservableResult(page, runMatch[1]!, runMatch[2]!);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page
        .getByTestId('outcome-product-state')
        .waitFor({ state: 'visible', timeout: 60_000 });
      expect(
        await page.getByTestId('outcome-product-state').innerText(),
      ).toMatch(/Complete/u);
      await page.locator('.work-overview__outcome').waitFor({
        state: 'visible',
        timeout: 60_000,
      });
      await page.getByRole('tab', { name: 'MCP Activity' }).click();
      await page.getByTestId('trace-events').waitFor({
        state: 'visible',
        timeout: 60_000,
      });
      await page
        .getByRole('button', { name: 'Respond in conversation' })
        .click();
      await page.waitForURL(`/conversations/${conversationId}`, {
        timeout: 60_000,
      });
      await page.locator('.chat-header h1').waitFor({ state: 'visible' });
    },
    testTimeout,
  );
});

async function waitForObservableResult(
  page: Page,
  workId: string,
  runId: string,
): Promise<void> {
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const response = await page.request.get(
      `/api/works/${workId}/runs/${runId}`,
      { headers: { accept: 'application/json' } },
    );
    if (!response.ok())
      throw new Error(`Run read failed with ${response.status()}.`);
    const value = (await response.json()) as {
      projection_status?: unknown;
      work_run?: { product_state?: unknown };
    };
    if (
      value.projection_status === 'internally_anchored' &&
      value.work_run?.product_state !== 'running'
    ) {
      expect(value.work_run?.product_state).toBe('complete');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('Timed out waiting for the UI-started Work Run result.');
}

async function boundedErrorBody(
  response: import('playwright').Response,
): Promise<string> {
  const raw = (await response.text()).slice(0, 4_096);
  try {
    const value = JSON.parse(raw) as {
      error?: { code?: unknown; message?: unknown };
    };
    const code =
      typeof value.error?.code === 'string'
        ? value.error.code
        : 'unknown_error';
    const message =
      typeof value.error?.message === 'string'
        ? value.error.message.slice(0, 512)
        : 'The service returned no error detail.';
    return `${code}: ${message}`;
  } catch {
    return 'The service returned an invalid error response.';
  }
}
