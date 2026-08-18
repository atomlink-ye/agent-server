/// <reference lib="dom" />

import { randomUUID } from 'node:crypto';

import { chromium, type Browser, type Page } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';

import { ProductDeveloperClient } from '../src/adapters/http/product-developer-client.js';

const baseUrl = process.env.WEB_E2E_BASE_URL?.replace(/\/$/u, '');
const agentServerBaseUrl = process.env.AGENT_SERVER_BASE_URL;
const agentServerToken = process.env.AGENT_SERVER_SERVICE_TOKEN;
const testTimeout = 8 * 60 * 1000;
const marker = 'MVE_CODE_GARDENING_BROWSER_OK';
let browser: Browser | undefined;
let t0 = 0;
function progress(stage: string, extra?: Record<string, unknown>): void {
  console.log(JSON.stringify({ stage, elapsed_ms: Date.now() - t0, ...extra }));
}

describe.skipIf(baseUrl === undefined)(
  'web Product Work same-origin E2E shell',
  () => {
    afterEach(async () => {
      await browser?.close();
      browser = undefined;
    });

    it(
      'clicks Start Run, reaches real provider output, Trace, and the exact DefinitionVersion',
      async () => {
        t0 = Date.now();
        progress('test_start');
        const seeded = await seedProductWork();
        const browserOrigin = new URL(baseUrl!).origin;
        if (!new URL(baseUrl!).hostname.endsWith('.localhost'))
          throw new Error('WEB_E2E_BASE_URL must use a trustworthy .localhost hostname.');

        browser = await chromium.launch({ headless: true });
        const page = await (await browser.newContext({ baseURL: baseUrl! })).newPage();
        const paths = captureSameOriginPaths(page, browserOrigin);

        progress('goto_start', { workId: seeded.workId });
        await page.goto(`/works/${seeded.workId}`, {
          waitUntil: 'domcontentloaded',
          timeout: 60_000,
        });
        progress('goto_done');
        await page.getByText('Product Work/Run reads', { exact: false }).waitFor({
          state: 'visible',
          timeout: 30_000,
        });

        const startResponsePromise = page.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            sameOrigin(response.url(), browserOrigin) &&
            new URL(response.url()).pathname ===
              `/api/works/${seeded.workId}/runs`,
          { timeout: 30_000 },
        );
        await page.getByRole('button', { name: 'Start Run' }).click();
        const startResponse = await startResponsePromise;
        expect(startResponse.status(), 'not_implemented').toBe(202);
        const started = (await startResponse.json()) as {
          work_run?: { id?: unknown; definition_version_id?: unknown };
        };
        if (typeof started.work_run?.id !== 'string')
          throw new Error('Start Run response did not expose a Product WorkRun id.');
        expect(started.work_run.definition_version_id).toBe(
          seeded.definitionVersionId,
        );

        progress('wait_run_start', { workRunId: started.work_run.id });
        await waitForCompleteWorkRun(page, seeded.workId, started.work_run.id);
        progress('wait_run_done');
        await page.goto(
          `/works/${seeded.workId}?run=${started.work_run.id}`,
          { waitUntil: 'domcontentloaded', timeout: 30_000 },
        );
        await page.getByTestId('outcome-product-state').waitFor({
          state: 'visible',
          timeout: 30_000,
        });
        await page.getByText(marker, { exact: false }).waitFor({
          state: 'visible',
          timeout: 30_000,
        });
        expect(await page.getByTestId('mcp-only-warning').isVisible()).toBe(true);

        const exactDefinitionPath =
          `/api/work-definition-versions/${seeded.definitionVersionId}`;
        expect(paths.responses).toContain(exactDefinitionPath);
        expect(paths.requests).not.toContain(
          `/api/works/${seeded.workId}/definition`,
        );

        await page.getByRole('link', { name: 'Definition' }).click();
        await page.getByTestId('definition-viewer').waitFor({
          state: 'visible',
          timeout: 30_000,
        });
        expect(
          await page.getByText(seeded.definitionName, { exact: true }).isVisible(),
        ).toBe(true);
      },
      testTimeout,
    );
  },
);

async function seedProductWork(): Promise<{
  readonly workId: string;
  readonly definitionVersionId: string;
  readonly definitionName: string;
}> {
  if (!agentServerBaseUrl || !agentServerToken)
    throw new Error(
      'Real-browser Work E2E requires AGENT_SERVER_BASE_URL and AGENT_SERVER_SERVICE_TOKEN.',
    );
  progress('seed_start');
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const definitionName = `web-gardening-${suffix}`;
  const fetchWithTimeout = (
    url: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  const client = new ProductDeveloperClient({
    baseUrl: agentServerBaseUrl,
    token: agentServerToken,
    fetch: fetchWithTimeout,
  });
  progress('seed_apply_start');
  const applied = await client.applyDefinition(
    productDefinitionSource(definitionName, suffix),
    `web-gardening-definition-${suffix}`,
  );
  progress('seed_apply_done');
  progress('seed_create_start');
  const created = await client.createWork({
    definitionId: applied.definition.id,
    definitionVersionId: applied.version.id,
    title: `Web gardening ${suffix}`,
  });
  progress('seed_create_done');
  return {
    workId: created.work.id,
    definitionVersionId: applied.version.id,
    definitionName,
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

async function waitForCompleteWorkRun(
  page: Page,
  workId: string,
  workRunId: string,
): Promise<void> {
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const response = await page.request.get(
      `${baseUrl}/api/works/${workId}/runs/${workRunId}`,
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
          `Browser-started WorkRun reached ${String(value.work_run?.product_state)} instead of complete.`,
        );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Timed out waiting for the browser-started WorkRun to finish.');
}

function captureSameOriginPaths(page: Page, origin: string) {
  const requests: string[] = [];
  const responses: string[] = [];
  page.on('request', (request) => {
    if (sameOrigin(request.url(), origin))
      requests.push(new URL(request.url()).pathname);
  });
  page.on('response', (response) => {
    if (sameOrigin(response.url(), origin) && response.ok())
      responses.push(new URL(response.url()).pathname);
  });
  return { requests, responses };
}

function sameOrigin(value: string, origin: string): boolean {
  return new URL(value).origin === origin;
}
