/// <reference lib="dom" />

import { randomUUID } from 'node:crypto';

import { chromium, type Browser, type Page } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';

import { ProductDeveloperClient } from '../src/adapters/http/product-developer-client.js';

const baseUrlEnv = process.env.WEB_E2E_BASE_URL;
const configuredWorkId = process.env.PRODUCT_E2E_WORK_ID;
const agentServerBaseUrl = process.env.AGENT_SERVER_BASE_URL;
const agentServerToken = process.env.AGENT_SERVER_SERVICE_TOKEN;
const baseUrl = baseUrlEnv?.replace(/\/$/u, '');
const testTimeout = 10 * 60 * 1000;
const marker = 'MVE_CODE_GARDENING_BROWSER_OK';
let browser: Browser | undefined;

describe.skipIf(baseUrl === undefined)(
  'web Product Work same-origin E2E shell',
  () => {
    afterEach(async () => {
      await browser?.close();
      browser = undefined;
    });

    it(
      'starts a real WorkRun, renders its Trace, and reads the exact Product DefinitionVersion',
      async () => {
        const seeded = await resolveWorkFixture();
        const browserOrigin = new URL(baseUrl!).origin;
        const browserHostname = new URL(baseUrl!).hostname;
        if (!browserHostname.endsWith('.localhost'))
          throw new Error(
            `WEB_E2E_BASE_URL must use a trustworthy .localhost hostname: ${browserOrigin}`,
          );
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({ baseURL: baseUrl! });
        const page = await context.newPage();
        const capture = captureSameOriginNetwork(page, browserOrigin);

        await page.goto(`/works/${encodeURIComponent(seeded.workId)}`, {
          waitUntil: 'domcontentloaded',
          timeout: testTimeout,
        });
        await page.getByTestId('work-detail-shell').waitFor({
          state: 'visible',
          timeout: testTimeout,
        });
        expect(
          await page.getByText('Product Work/Run reads', { exact: false }).isVisible(),
          'display_bug',
        ).toBe(true);

        const startResponsePromise = page.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            sameOrigin(response.url(), browserOrigin) &&
            new URL(response.url()).pathname ===
              `/api/works/${seeded.workId}/runs`,
          { timeout: testTimeout },
        );
        await page.getByRole('button', { name: 'Start Run' }).click();
        const startResponse = await startResponsePromise;
        expect(startResponse.status(), 'not_implemented').toBe(202);
        const started = (await startResponse.json()) as {
          work_run?: { id?: unknown; definition_version_id?: unknown };
        };
        const workRunId = started.work_run?.id;
        if (typeof workRunId !== 'string')
          throw new Error('Start Run response did not expose a Product WorkRun id.');
        expect(started.work_run?.definition_version_id).toBe(
          seeded.definitionVersionId,
        );

        await waitForTerminalWorkRun(page, seeded.workId, workRunId);
        await page.goto(
          `/works/${encodeURIComponent(seeded.workId)}?run=${encodeURIComponent(workRunId)}`,
          { waitUntil: 'domcontentloaded', timeout: testTimeout },
        );
        await page.getByTestId('outcome-product-state').waitFor({
          state: 'visible',
          timeout: testTimeout,
        });
        if (seeded.selfSeeded)
          await page.getByText(marker, { exact: false }).waitFor({
            state: 'visible',
            timeout: testTimeout,
          });

        expect(capture.bffRequests.length, 'display_bug').toBeGreaterThan(0);
        expect(capture.bffResponses.length, 'display_bug').toBeGreaterThan(0);
        expect(
          capture.bffResponses
            .filter((response) => response.status >= 200 && response.status < 300)
            .every(
              (response) =>
                response.headers['x-agent-server-upstream'] === 'fetched',
            ),
          'not_implemented',
        ).toBe(true);
        expect(
          await page.getByTestId('attention-basis').isVisible(),
          'display_bug',
        ).toBe(true);
        expect(
          await page.getByTestId('mcp-only-warning').isVisible(),
          'display_bug',
        ).toBe(true);

        const exactDefinitionResponse = page.waitForResponse(
          (response) =>
            response.request().method() === 'GET' &&
            sameOrigin(response.url(), browserOrigin) &&
            new URL(response.url()).pathname ===
              `/api/work-definition-versions/${seeded.definitionVersionId}`,
          { timeout: testTimeout },
        );
        await page.getByRole('link', { name: 'Definition' }).click();
        const definitionResponse = await exactDefinitionResponse;
        expect(definitionResponse.ok(), 'not_implemented').toBe(true);
        await page.getByTestId('definition-viewer').waitFor({
          state: 'visible',
          timeout: testTimeout,
        });
        expect(
          await page.getByText(seeded.definitionName, { exact: true }).isVisible(),
          'display_bug',
        ).toBe(true);
        expect(capture.teamDefinitionRequests).toHaveLength(0);
      },
      testTimeout,
    );
  },
);

async function resolveWorkFixture(): Promise<{
  readonly workId: string;
  readonly definitionVersionId: string;
  readonly definitionName: string;
  readonly selfSeeded: boolean;
}> {
  if (configuredWorkId) {
    if (!agentServerBaseUrl || !agentServerToken)
      throw new Error(
        'AGENT_SERVER_BASE_URL and AGENT_SERVER_SERVICE_TOKEN are required with PRODUCT_E2E_WORK_ID so its Definition can be resolved.',
      );
    const client = new ProductDeveloperClient({
      baseUrl: agentServerBaseUrl,
      token: agentServerToken,
    });
    const workResponse = await fetch(
      `${agentServerBaseUrl.replace(/\/$/u, '')}/api/v1/works/${configuredWorkId}`,
      { headers: { authorization: `Bearer ${agentServerToken}` } },
    );
    if (!workResponse.ok) throw new Error('Configured Product Work is unavailable.');
    const body = (await workResponse.json()) as {
      work?: { definition_version_id?: unknown };
    };
    const definitionVersionId = body.work?.definition_version_id;
    if (typeof definitionVersionId !== 'string')
      throw new Error('Configured Product Work has no DefinitionVersion id.');
    const version = await client.getDefinitionVersion(definitionVersionId);
    return {
      workId: configuredWorkId,
      definitionVersionId,
      definitionName: definitionNameFromSource(version.source),
      selfSeeded: false,
    };
  }

  if (!agentServerBaseUrl || !agentServerToken)
    throw new Error(
      'Self-seeding web Product Work E2E requires AGENT_SERVER_BASE_URL and AGENT_SERVER_SERVICE_TOKEN.',
    );
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const definitionName = `web-gardening-${suffix}`;
  const client = new ProductDeveloperClient({
    baseUrl: agentServerBaseUrl,
    token: agentServerToken,
  });
  const source = productDefinitionSource(definitionName, suffix);
  const applied = await client.applyDefinition(
    source,
    `web-gardening-definition-${suffix}`,
  );
  const created = await client.createWork({
    definitionId: applied.definition.id,
    definitionVersionId: applied.version.id,
    title: `Web gardening ${suffix}`,
  });
  return {
    workId: created.work.id,
    definitionVersionId: applied.version.id,
    definitionName,
    selfSeeded: true,
  };
}

function productDefinitionSource(name: string, suffix: string): string {
  return `apiVersion: agentserver.dev/v1alpha1
kind: WorkDefinition
metadata:
  name: ${name}
  description: Real-browser MVE gardening golden path.
spec:
  kind: single_agent
  agent:
    source: |
      apiVersion: agent-server/v1alpha1
      kind: ManagedAgent
      metadata:
        name: web-gardening-agent-${suffix}
      spec:
        description: Real browser MVE golden path Agent
        instructions: "Return exactly ${marker}. Do not call tools."
        runtime:
          provider: paseo
          modelPolicyRef: free-only
          mode: isolated
        tools: []
        skills: []
        input:
          schema:
            type: object
            properties: {}
            additionalProperties: false
          prompt: "Return the required marker."
        session:
          invocation: fresh_per_invocation
          followUps: queued
          binding: reusable
        memory:
          policy: workspace_snapshot
          proposalLimit: 0
        permissions:
          network: none
          filesystem: none
        completion:
          type: executable
          command: "done"
  environment:
    source: |
      apiVersion: agent-server/v1alpha1
      kind: ManagedEnvironment
      metadata:
        name: web-gardening-environment-${suffix}
      spec:
        adapter: paseo
        provider: opencode
        modelPolicyRef: free-only
        runtimeCellPolicy: per_runtime_session
  memory_version_ids: []
  input_schema:
    type: object
    properties: {}
    required: []
    additional_properties: false
`;
}

async function waitForTerminalWorkRun(
  page: Page,
  workId: string,
  workRunId: string,
): Promise<void> {
  const deadline = Date.now() + testTimeout;
  while (Date.now() < deadline) {
    const response = await page.request.get(
      `${baseUrl}/api/works/${encodeURIComponent(workId)}/runs/${encodeURIComponent(workRunId)}`,
      { headers: { accept: 'application/json' } },
    );
    if (!response.ok())
      throw new Error(`Product WorkRun read failed with ${response.status()}.`);
    const value = (await response.json()) as {
      projection_status?: unknown;
      work_run?: { product_state?: unknown };
    };
    if (
      value.projection_status === 'internally_anchored' &&
      value.work_run?.product_state !== 'running'
    ) {
      if (value.work_run?.product_state !== 'complete')
        throw new Error(
          `Real-browser WorkRun reached ${String(value.work_run?.product_state)} instead of complete.`,
        );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Timed out waiting for the browser-started WorkRun to finish.');
}

function definitionNameFromSource(source: Record<string, unknown>): string {
  const metadata = source.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
    return 'Work Definition';
  const name = (metadata as Record<string, unknown>).name;
  return typeof name === 'string' ? name : 'Work Definition';
}

function captureSameOriginNetwork(page: Page, origin: string) {
  const requests: Array<{ method: string; url: string }> = [];
  const responses: Array<{
    status: number;
    url: string;
    headers: Record<string, string>;
  }> = [];
  page.on('request', (request) => {
    if (sameOrigin(request.url(), origin))
      requests.push({ method: request.method(), url: request.url() });
  });
  page.on('response', (response) => {
    if (sameOrigin(response.url(), origin))
      responses.push({
        status: response.status(),
        url: response.url(),
        headers: response.headers(),
      });
  });
  return {
    get bffRequests() {
      return requests.filter((request) =>
        /^\/api\/(?:works|work-definition-versions)(?:\/|$)/u.test(
          new URL(request.url).pathname,
        ),
      );
    },
    get bffResponses() {
      return responses.filter((response) =>
        /^\/api\/(?:works|work-definition-versions)(?:\/|$)/u.test(
          new URL(response.url).pathname,
        ),
      );
    },
    get teamDefinitionRequests() {
      return requests.filter((request) =>
        /^\/api\/works\/[^/]+\/definition$/u.test(
          new URL(request.url).pathname,
        ),
      );
    },
  };
}

function sameOrigin(value: string, origin: string): boolean {
  return new URL(value).origin === origin;
}
