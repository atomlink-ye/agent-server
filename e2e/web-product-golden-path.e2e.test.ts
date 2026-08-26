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
const canonicalUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
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
      const conversationListResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'GET' &&
          new URL(response.url()).origin === browserOrigin &&
          new URL(response.url()).pathname === '/api/conversations',
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
      expect((await conversationListResponse).status()).toBe(200);
      await page.waitForFunction(
        (expectedName) =>
          document.querySelector('.chat-header h1')?.textContent?.trim() ===
          expectedName,
        coworkerName,
        { timeout: 60_000 },
      );
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
      await page.waitForURL(
        (url) =>
          url.origin === browserOrigin &&
          /^\/agents\/[0-9a-f-]+$/iu.test(url.pathname),
        { timeout: 60_000 },
      );
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
          `Capability binding failed (${savedBinding.status()}): ${await boundedErrorBody(savedBinding)} request=${sanitizedBindingRequest(savedBinding)}`,
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
          new URL(response.url()).origin === browserOrigin &&
          new URL(response.url()).pathname === '/api/works',
      );
      const runRequest = handledWait(
        page.waitForRequest(
          (request) =>
            request.method() === 'POST' &&
            new URL(request.url()).origin === browserOrigin &&
            /\/api\/works\/[^/]+\/runs$/iu.test(
              new URL(request.url()).pathname,
            ),
          { timeout: 60_000 },
        ),
      );
      const runResponse = handledWait(
        page.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            new URL(response.url()).origin === browserOrigin &&
            /\/api\/works\/[^/]+\/runs$/iu.test(
              new URL(response.url()).pathname,
            ),
          { timeout: 60_000 },
        ),
      );
      await page.getByRole('button', { name: 'Start Work' }).click();
      const createdWorkResponse = await workCreateResponse;
      if (!createdWorkResponse.ok()) {
        // Both waiters convert rejection to a handled result. Closing the
        // browser in afterEach cancels them without unhandled rejections.
        void Promise.all([runRequest, runResponse]);
        throw new Error(
          `Work creation failed (${createdWorkResponse.status()}): ${await boundedErrorBody(createdWorkResponse)} request=${sanitizedWorkCreateRequest(createdWorkResponse)}`,
        );
      }
      expect(createdWorkResponse.status()).toBe(201);
      const createdWorkBody = (await createdWorkResponse.json()) as {
        work?: { id?: unknown };
      };
      const createdWorkId = createdWorkBody.work?.id;
      if (
        typeof createdWorkId !== 'string' ||
        !canonicalUuid.test(createdWorkId)
      )
        throw new Error(
          `Work creation returned a malformed Work id: ${sanitizedWorkCreateRequest(createdWorkResponse)}`,
        );
      const expectedRunPath = `/api/works/${createdWorkId}/runs`;
      let submittedRunRequest: import('playwright').Request;
      let startedRunResponse: import('playwright').Response;
      let observedRunPath = expectedRunPath;
      try {
        const [runRequestResult, runResponseResult] = await Promise.all([
          runRequest,
          runResponse,
        ]);
        if ('error' in runRequestResult) throw runRequestResult.error;
        submittedRunRequest = runRequestResult.value;
        observedRunPath = new URL(submittedRunRequest.url()).pathname;
        if ('error' in runResponseResult) throw runResponseResult.error;
        startedRunResponse = runResponseResult.value;
      } catch (error) {
        throw new Error(
          `Work Run request was not sent after Work creation: workId=${createdWorkId} runPath=${observedRunPath} ui=${await boundedUiStatus(page)} (${error instanceof Error ? error.message : String(error)})`,
        );
      }
      expect(JSON.parse(submittedRunRequest.postData() ?? '{}')).toMatchObject({
        trigger_kind: 'manual',
        input: { company: 'Acme' },
      });
      expect(startedRunResponse.status()).toBe(202);
      await page.waitForURL(
        (url) =>
          url.origin === browserOrigin &&
          url.pathname === `/work/${createdWorkId}` &&
          url.searchParams.get('from_conversation') === conversationId &&
          canonicalUuid.test(url.searchParams.get('run') ?? ''),
        { timeout: 60_000 },
      );
      await page.getByText(/Product Work\/Run reads/u).waitFor({
        state: 'visible',
        timeout: 60_000,
      });

      const startedUrl = new URL(page.url());
      const workMatch = startedUrl.pathname.match(/^\/work\/([^/]+)$/u);
      const runId = startedUrl.searchParams.get('run');
      if (
        !workMatch ||
        workMatch[1] !== createdWorkId ||
        !runId ||
        !canonicalUuid.test(runId)
      )
        throw new Error(
          'The started Work URL did not include the expected Run.',
        );
      await waitForObservableResult(page, createdWorkId, runId);
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

type WaitOutcome<T> = { readonly value: T } | { readonly error: unknown };

function handledWait<T>(promise: Promise<T>): Promise<WaitOutcome<T>> {
  return promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
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

function sanitizedBindingRequest(
  response: import('playwright').Response,
): string {
  const raw = response.request().postData();
  if (!raw) return '{}';
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return JSON.stringify({
      definition_id: boundedRequestValue(value.definition_id),
      definition_version_id: boundedRequestValue(value.definition_version_id),
    });
  } catch {
    return '{}';
  }
}

function sanitizedWorkCreateRequest(
  response: import('playwright').Response,
): string {
  const raw = response.request().postData();
  if (!raw) return '{}';
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return JSON.stringify({
      definition_id: boundedRequestValue(value.definition_id),
      definition_version_id: boundedRequestValue(value.definition_version_id),
      title: boundedRequestValue(value.title),
    });
  } catch {
    return '{}';
  }
}

function boundedRequestValue(value: unknown): string | null {
  return typeof value === 'string' ? value.slice(0, 128) : null;
}

async function boundedUiStatus(page: Page): Promise<string> {
  const status = page.getByTestId('new-work-status');
  try {
    return ((await status.innerText()) || 'No Work status was rendered.').slice(
      0,
      512,
    );
  } catch {
    return 'No Work status was rendered.';
  }
}
