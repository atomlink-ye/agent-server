/// <reference lib="dom" />

import { lookup } from 'node:dns/promises';

import { chromium, type Browser, type Page } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';

const baseUrlEnv = process.env.WEB_E2E_BASE_URL;
const workIdEnv = process.env.PRODUCT_E2E_WORK_ID;
const configuredEnvironmentCount = [baseUrlEnv, workIdEnv].filter(
  (value) => value !== undefined,
).length;
if (configuredEnvironmentCount !== 0 && configuredEnvironmentCount !== 2)
  throw new Error(
    'WEB_E2E_BASE_URL and PRODUCT_E2E_WORK_ID must be set together',
  );

const baseUrl = baseUrlEnv?.replace(/\/$/u, '');
const workId = workIdEnv;
const testTimeout = 60 * 1000;
let browser: Browser | undefined;

describe.skipIf(baseUrl === undefined || workId === undefined)(
  'web Product Work same-origin E2E shell',
  () => {
    afterEach(async () => {
      await browser?.close();
      browser = undefined;
    });

    it('captures the Work page and its same-origin BFF read request', async () => {
      const browserOrigin = new URL(baseUrl!).origin;
      const browserHostname = new URL(baseUrl!).hostname;
      if (!browserHostname.endsWith('.localhost'))
        throw new Error(
          `WEB_E2E_BASE_URL must use a trustworthy .localhost hostname: ${browserOrigin}`,
        );
      const { address: webAddress } = await lookup('web', { family: 4 });
      browser = await chromium.launch({
        headless: true,
        args: [`--host-resolver-rules=MAP ${browserHostname} ${webAddress}`],
      });
      const context = await browser.newContext({ baseURL: baseUrl! });
      const page = await context.newPage();
      const capture = captureSameOriginNetwork(page, browserOrigin);
      const bffResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'GET' &&
          sameOrigin(response.url(), browserOrigin) &&
          /^\/api\/works\/[^/]+$/u.test(new URL(response.url()).pathname),
        { timeout: testTimeout },
      );

      await page.goto(`/works/${encodeURIComponent(workId!)}`, {
        waitUntil: 'domcontentloaded',
        timeout: testTimeout,
      });
      const bffResponse = await bffResponsePromise;
      expect(capture.bffRequests.length).toBeGreaterThan(0);
      expect(capture.bffResponses.length).toBeGreaterThan(0);
      expect(
        await page.getByTestId('work-detail-shell').isVisible(),
        'display_bug',
      ).toBe(true);
      expect(
        await page.getByText('read-only Work-first surface').isVisible(),
        'display_bug',
      ).toBe(true);
      expect(
        await page
          .getByText('Controls are explicitly unavailable.')
          .isVisible(),
        'display_bug',
      ).toBe(true);

      if (bffResponse.status() === 501) {
        expect(await bffResponse.json(), 'not_implemented').toEqual({
          error: 'not_implemented',
        });
      } else {
        expect(bffResponse.ok(), 'not_implemented').toBe(true);
      }
    });
  },
);

function captureSameOriginNetwork(page: Page, origin: string) {
  const requests: Array<{ method: string; url: string }> = [];
  const responses: Array<{ status: number; url: string }> = [];
  page.on('request', (request) => {
    if (sameOrigin(request.url(), origin))
      requests.push({ method: request.method(), url: request.url() });
  });
  page.on('response', (response) => {
    if (sameOrigin(response.url(), origin))
      responses.push({ status: response.status(), url: response.url() });
  });
  return {
    requests,
    responses,
    get bffRequests() {
      return requests.filter((request) =>
        /^\/api\/works(?:\/|$)/u.test(new URL(request.url).pathname),
      );
    },
    get bffResponses() {
      return responses.filter((response) =>
        /^\/api\/works(?:\/|$)/u.test(new URL(response.url).pathname),
      );
    },
  };
}

function sameOrigin(value: string, origin: string): boolean {
  return new URL(value).origin === origin;
}
