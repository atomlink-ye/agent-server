import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const mode = required('R2_BROWSER_MODE');
if (mode !== 'create' && mode !== 'send') {
  throw new Error('R2_BROWSER_MODE must be create or send.');
}
const baseUrl = required('CHAT_BASE_URL').replace(/\/$/, '');
const agentDefinitionId = required('PUBLISHED_AGENT_DEFINITION_ID');
const prompt = mode === 'send' ? required('CHAT_PROMPT') : null;
const conversationId = mode === 'send' ? required('R2_CONVERSATION_ID') : null;
const outputDirectory = required('EVIDENCE_OUTPUT_DIR');
const maxWaitMs = boundedWait(required('MAX_WAIT_MS'));

if (!/^https?:\/\//i.test(baseUrl)) {
  throw new Error('CHAT_BASE_URL must be an http(s) URL.');
}
if (conversationId !== null && !UUID_SEGMENT.test(conversationId)) {
  throw new Error('R2_CONVERSATION_ID must be a UUID.');
}
if (!path.isAbsolute(outputDirectory)) {
  throw new Error('EVIDENCE_OUTPUT_DIR must be an absolute path.');
}

await mkdir(outputDirectory, { recursive: true });

const networkStatus = [];
let browser;
let context;
let page;
let resultCode = 0;
let failureMessage = null;
const deadline = Date.now() + maxWaitMs;

const recordResponse = (response) => {
  try {
    const url = new URL(response.url());
    networkStatus.push({
      method: response.request().method(),
      path: normalizePath(url.pathname),
      status: response.status(),
    });
  } catch {
    // A response without a usable URL is not evidence for this flow.
  }
};

const remaining = () => {
  const value = deadline - Date.now();
  if (value <= 0) throw new Error(`Bounded wait exceeded (${maxWaitMs}ms).`);
  return value;
};

const waitForResponse = async (predicate, label) => {
  try {
    return await page.waitForResponse(predicate, { timeout: remaining() });
  } catch (error) {
    throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const waitForExactCount = async (locator, selector, expected, label) => {
  try {
    await page.waitForFunction(
      ({ selector: query, expected: count }) => document.querySelectorAll(query).length === count,
      { selector, expected },
      { timeout: remaining() },
    );
    const actual = await locator.count();
    if (actual !== expected) {
      throw new Error(`observed ${actual}, expected ${expected}`);
    }
  } catch (error) {
    throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const waitForEditable = async (locator, label) => {
  try {
    await locator.waitFor({ state: 'visible', timeout: remaining() });
    const handle = await locator.elementHandle({ timeout: remaining() });
    if (!handle) throw new Error('editable control was not attached');
    try {
      await page.waitForFunction(
        (element) => {
          if (!(
            element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement ||
            element instanceof HTMLSelectElement ||
            element instanceof HTMLButtonElement
          )) {
            return false;
          }
          return !element.disabled && !('readOnly' in element && element.readOnly);
        },
        handle,
        { timeout: remaining() },
      );
    } finally {
      await handle.dispose();
    }
  } catch (error) {
    throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const waitForVisible = async (locator, label) => {
  try {
    await locator.waitFor({ state: 'visible', timeout: remaining() });
    if (!(await locator.isVisible())) throw new Error('element was not visible');
  } catch (error) {
    throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const assertStatus = (response, expected, label) => {
  if (response.status() !== expected) {
    throw new Error(`${label} returned HTTP ${response.status()}, expected ${expected}.`);
  }
};

// 🔴 Auditor finding-1-8861bd03：本文件是【第三条】可独立执行的产品路径 ——
// 它直接产生 POST /api/conversations 与 POST /api/conversations/:id/messages，
// 给齐环境直接调用即可绕过 run.mjs 与 phase0-driver.mjs 两道闸门，所以这里也必须过闸门。
// 🔴 必须放在 try 之外：本文件的 catch 会把异常吞成一次"跑过并失败"的 run-result.json，
// 而闸门失败【不是一次失败的运行】—— 它必须在任何浏览器动作之前中止，且不产出 run 结果。
// ⛔ 不许加环境变量跳过它。
// 🔴 容器内没有 git（判据：docker run --rm agent-server-web-testing:r2 bash -lc 'git --version'
// → command not found），所以这里不能自己跑 checkPreconditions —— 那需要 git 和工作树。
// 改为核验 driver 已经求过值、并挂载进来的那份报告，两个变量都是 required()：
// ⛔ 不许加环境变量跳过它，⛔ 不许在缺变量时退回"不检查"。
{
  const reportPath = required('ACCEPTANCE_GATE_REPORT');
  const expectedHead = required('ACCEPTANCE_GATE_HEAD');
  const { readFile } = await import('node:fs/promises');
  const { assertGateReport } = await import('./gate-report.mjs');
  assertGateReport(JSON.parse(await readFile(reportPath, 'utf8')), expectedHead);
}

try {
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ baseURL: baseUrl });
  context.on('response', recordResponse);
  await context.tracing.start({
    screenshots: true,
    snapshots: true,
    sources: false,
  });
  page = await context.newPage();

  const conversationsResponsePromise = waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === 'GET' &&
      url.origin === new URL(baseUrl).origin &&
      url.pathname === '/api/conversations'
    );
  }, 'Initial conversation list response timed out');
  await page.goto(baseUrl, {
    waitUntil: 'domcontentloaded',
    timeout: remaining(),
  });
  const conversationsResponse = await conversationsResponsePromise;
  assertStatus(conversationsResponse, 200, 'GET /api/conversations');
  const newConversationButton = page.getByRole('button', {
    name: 'New conversation',
  });
  await waitForVisible(newConversationButton, 'New conversation control did not become visible');

  if (mode === 'create') {
    await newConversationButton.click();
    const agentDefinitionInput = page.getByLabel('Agent definition ID');
    await waitForEditable(
      agentDefinitionInput,
      'Agent definition ID input did not become editable',
    );
    await agentDefinitionInput.fill(agentDefinitionId);
    const createResponsePromise = waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/conversations',
      'Create conversation response timed out',
    );
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    const createResponse = await createResponsePromise;
    assertStatus(createResponse, 201, 'POST /api/conversations');
    const createPayload = await createResponse.json().catch(() => null);
    const createdConversationId = createPayload?.conversation?.conversation_id;
    if (typeof createdConversationId !== 'string' || !UUID_SEGMENT.test(createdConversationId)) {
      throw new Error('Create response did not contain a valid conversation ID.');
    }
    console.log(`R2_CONVERSATION_ID=${createdConversationId}`);
  } else {
    const conversationRows = page.locator('[aria-label="Conversations"] [data-conversation-id]');
    await waitForExactCount(
      conversationRows,
      '[aria-label="Conversations"] [data-conversation-id]',
      1,
      'Scoped conversation list did not settle',
    );
    const conversationRow = conversationRows.first();
    const listedConversationId = await conversationRow.getAttribute('data-conversation-id');
    if (listedConversationId !== conversationId) {
      throw new Error('Scoped conversation list did not contain the requested conversation.');
    }
    await conversationRow.click();

    const messageBox = page.getByRole('textbox', { name: 'Message', exact: true });
    await waitForEditable(messageBox, 'Message field did not become editable');
    await messageBox.fill(prompt);
    const messageResponsePromise = waitForResponse((response) => {
      const pathname = new URL(response.url()).pathname;
      return (
        response.request().method() === 'POST' &&
        /^\/api\/conversations\/[^/]+\/messages$/.test(pathname)
      );
    }, 'Message response timed out');
    await page.getByRole('button', { name: 'Send message' }).click();
    const messageResponse = await messageResponsePromise;
    assertStatus(messageResponse, 202, 'POST /api/conversations/:id/messages');

    const postReturnedAt = new Date().toISOString();
    const actions = [];
    let firstVisibleAt;
    let workRef;
    while (Date.now() < deadline) {
      actions.push('dom-read');
      const card = page.locator('aside[aria-label="Work update"]');
      if (await card.count() > 0 && await card.first().isVisible()) {
        firstVisibleAt = new Date().toISOString();
        workRef = await card.first().getAttribute('data-work-ref') ?? 'visible-work-card';
        break;
      }
      actions.push('passive-wait');
      await page.waitForTimeout(Math.min(3000, remaining()));
    }
    await writeJson(path.join(outputDirectory, 'step8-observation.json'), { maxWaitMs, postReturnedAt, firstVisibleAt, workRef, actions });
    if (!firstVisibleAt || !workRef) throw new Error('Work update did not become visible before T.');
    await page.screenshot({
      path: path.join(outputDirectory, 'chat.png'),
      fullPage: true,
    });
  }
} catch (error) {
  resultCode = 1;
  failureMessage = scrubMessage(error instanceof Error ? error.message : String(error));
  if (page) {
    try {
      await page.screenshot({
        path: path.join(outputDirectory, 'failure.png'),
        fullPage: true,
      });
    } catch {
      // Preserve the primary failure and still write the scrubbed result.
    }
  }
} finally {
  if (context) {
    try {
      await context.tracing.stop({
        path: path.join(outputDirectory, 'trace.zip'),
      });
    } catch {
      resultCode = 1;
      failureMessage ??= 'Unable to write Playwright trace.';
    }
  }
  await writeJson(path.join(outputDirectory, 'network-status.json'), networkStatus);
  await writeJson(path.join(outputDirectory, 'run-result.json'), {
    rc: resultCode,
    ...(failureMessage ? { error: failureMessage } : {}),
  });
  if (browser) await browser.close();
}

process.exitCode = resultCode;

function boundedWait(value) {
  if (!/^\d+$/.test(value)) throw new Error('MAX_WAIT_MS must be an integer.');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1000 || parsed > 600000) {
    throw new Error('MAX_WAIT_MS must be between 1000 and 600000.');
  }
  return parsed;
}

function normalizePath(pathname) {
  return pathname
    .split('/')
    .map((segment) => (UUID_SEGMENT.test(segment) ? ':id' : segment))
    .join('/');
}

function scrubMessage(message) {
  return message.replaceAll(baseUrl, '<base-url>').replace(UUID_SEGMENT, ':id');
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
