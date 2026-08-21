import { startAcceptanceEnvironment, apiProbeUrl } from './lifecycle.mjs';
import { parse as parseYaml } from 'yaml';
import { assertPreflight, assertFinalSql } from './preflight.mjs';
import { assertStep8Observation } from './golden-eight.mjs';
import { checkPreconditions, assertPreconditions } from './preconditions.mjs';
import { readServiceToken } from './credentials.mjs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFile as rawExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const DRIVER = path.join(REPO_ROOT, 'scripts/acceptance/phase0-driver.mjs');
const BROWSER_SCRIPT = path.join(REPO_ROOT, 'scripts/acceptance/phase0-browser.mjs');

// driver 是顶层脚本（phase0-driver.mjs:6-12 在模块顶层读环境、:18 顶层 await），
// ⛔ 不可 import —— 一 import 就立刻执行。R3 本来就是把它当子进程跑的，这里复用同一调用方式。
async function runDriver(env) {
  const exec = promisify(rawExecFile);
  try {
    const { stdout, stderr } = await exec('node', [DRIVER], { env, maxBuffer: 64 * 1024 * 1024 });
    return { rc: 0, stdout, stderr };
  } catch (e) {
    return { rc: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? String(e) };
  }
}

// 🔴 独立复核：从 driver 落盘的【原始 SQL 行】自己推导终局事实，
// ⛔ 不采信 driver 自己那句 rc=0。空结果必须显式红并说"未观察到"。
// 🔴 必须传入 step-8 在 DOM 里【实际观察到的】 workRef（Auditor finding-1-e09f1b9a）。
// 先前取"第一条带 work_ref 的消息"，反例：同一会话里 messages=[旧的已完成, 新的可见]、
// works=[旧:complete, 新:failed] ⇒ 返回旧的那条并判绿。
// ⇒ 界面上显示的是一个 Work Card，认证的却是同一会话里另一个更早的 Work。
// 关联校验只修了"无关行"，没修"哪一行才是相关的那一行"。
export function deriveTerminalFacts(observations, observedWorkRef) {
  if (typeof observedWorkRef !== 'string' || observedWorkRef.trim() === '') {
    throw new Error('final SQL observations: the step-8 observed workRef was not supplied — cannot certify which Work ran');
  }
  const messages = observations?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('final SQL observations: messages not observed');
  }
  const carrier = messages.find((m) => m.work_ref === observedWorkRef);
  if (!carrier) {
    throw new Error(`final SQL observations: no message carries the observed workRef ${observedWorkRef} — the Work Card on screen is not backed by an observed message`);
  }
  const works = observations?.works;
  if (!Array.isArray(works) || works.length === 0) throw new Error('final SQL observations: works not observed');
  const runs = observations?.runs;
  if (!Array.isArray(runs) || runs.length === 0) throw new Error('final SQL observations: work_runs not observed');

  const work = works.find((w) => w.id === observedWorkRef);
  if (!work) {
    throw new Error(`final SQL observations: observed workRef ${observedWorkRef} has no matching work row — association not observed`);
  }
  const run = runs.find((r) => r.work_id === work.id);
  if (!run) {
    throw new Error(`final SQL observations: work ${work.id} has no matching work_run — association not observed`);
  }
  // 🔴 works 表没有 status 列（0029_product_work_identity.sql:6-22）。
  // 先前这里读 work.status，对真实数据库行永远是 undefined —— 之所以对偶全绿，
  // 是因为 selftest 喂的是手写 JS 对象而非真实行（fixture 形状必须来自真实响应）。
  // 完成态的真实来源：work_runs.root_task_id -> tasks.status。
  const tasks = observations?.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error('final SQL observations: task rows not observed — cannot determine terminal state');
  }
  const task = tasks.find((t) => t.work_id === work.id);
  if (!task) {
    throw new Error(`final SQL observations: work ${work.id} has no bound root task — terminal state not observed`);
  }
  return { provider: carrier.provider, workRef: observedWorkRef, workRun: run.id, workStatus: task.status };
}


// 🔴 渲染必须复用起栈那条 invocation 的 command/args/environment（Oracle + Auditor 均指出过）。
// ⛔ 不许在这里另拼 environment —— 那会让判据自证：
// 渲染方替 environmentFor 补上它漏掉的端口变量，preflight 就永远发现不了启动路径的遗漏。
async function renderedComposeConfig(handle) {
  const exec = promisify(rawExecFile);
  const { composeInvocationForLocalEnvironment } = await import('../../tooling/environment/lifecycle.ts');
  const { command, args, environment } = await composeInvocationForLocalEnvironment(handle.state);
  const result = await exec(command, [...args, 'config'], { env: environment, maxBuffer: 32 * 1024 * 1024 });
  return { stdout: result.stdout, environment };
}

// 🔴 expected 必须来自【实际交给 Compose 的那份 environment】，⛔ 不许来自 handle.state.ports。
// 否则 environmentFor 漏掉一个端口导出时，判据两边都缺、照样相等 —— R3-73 变成不可检测。
export function expectedPortsFromEnvironment(environment) {
  const need = {
    postgres: ['AGENT_SERVER_TEST_POSTGRES_PORT', 5432],
    'agent-server': ['AGENT_SERVER_TEST_API_PORT', 3000],
    web: ['AGENT_SERVER_TEST_WEB_PORT', 3001],
  };
  const expected = {};
  const missing = [];
  for (const [service, [variable, target]] of Object.entries(need)) {
    const published = environment[variable];
    if (!published) { missing.push(variable); continue; }
    expected[service] = { hostIp: '127.0.0.1', published: Number(published), target };
  }
  if (missing.length) {
    throw new Error(`lifecycle environment did not export: ${missing.join(', ')} — not observed`);
  }
  return expected;
}

// 🔴 UI 就绪等待。`docker compose up --wait` 对【没有 healthcheck 的服务】只等到"在跑"，
// ⛔ 它打印的 `Healthy` 不代表就绪 —— 这是实测的，不是推断：
//   services: nohc(无 healthcheck) / withhc(有 healthcheck)
//   docker compose -p hcprobe up -d --wait
//   → `Container hcprobe-nohc-1  Healthy`   与有 healthcheck 的那个【一模一样】
// 而 web / web-vite 两个服务在四个 compose 文件与 Dockerfile 里都没有 healthcheck。
// ⇒ 装置先前把浏览器指向一个可能还在启动的 dev server，得到 ERR_SOCKET_NOT_CONNECTED。
// ⛔ 超时不许静默放行：它必须红，并把等了多久写进证据。
export async function waitForHttpReady(url, budgetMs, { intervalMs = 2000, now = () => Date.now(), fetchImpl = fetch } = {}) {
  const started = now();
  let attempts = 0;
  let lastError = 'no attempt was made';
  while (now() - started < budgetMs) {
    attempts += 1;
    try {
      const response = await fetchImpl(url, { redirect: 'manual' });
      if (response.status > 0) {
        return { url, ready: true, attempts, waitedMs: now() - started, status: response.status };
      }
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`${url} did not answer within ${budgetMs}ms (${attempts} attempt(s)); last error: ${lastError} — the UI was never ready, so no browser step may run`);
}

async function main() {
  const provider = process.argv[2];
  const model = process.argv[3];
  const evidenceDir = process.argv[4];
  if (!provider || !model || !evidenceDir) throw new Error('usage: acceptance:run <provider> <model> <evidence-dir>');
  const agentEnvPath = process.env.ACCEPTANCE_AGENT_ENV_PATH ?? '/root/.agent-env';
  await mkdir(evidenceDir, { recursive: true });

  // 🔴 闸门：在发出任何产品命令之前，在【本次运行自己的 HEAD】上验 P1/P2/P3。
  // 不过即中止，且不得发出任何产品命令。⛔ 不许用"某次跑过了"替代"这一次跑了"。
  const report = await checkPreconditions(REPO_ROOT);
  await writeFile(path.join(evidenceDir, 'preconditions.json'), JSON.stringify(report, null, 2));
  assertPreconditions(report);

  // ⛔ 不经 shell source 取 token（source 会吃掉双引号，见 credentials.mjs 注释）
  const { token } = await readServiceToken(agentEnvPath);

  // 🔴 固定 project 名，⛔ 不要用 lifecycle 默认的 `agent-server-test-${Date.now()...}`。
  // 默认那个每跑一次就是一套【新的命名卷】，而 web / web-vite 的 node_modules 卷是
  // `nocopy: true`（compose.web-vite.yaml）——新卷【不会】从镜像拷内容进来，是空的，
  // 反而把镜像里那份完整的 node_modules 挡住。于是每一次运行 web-vite 的 entrypoint
  // 都得先做一遍冷 pnpm install，装完 Vite 才开始服务。
  // 固定 project 名让卷跨运行保持热的，冷装只付第一次。
  // ⚠️ 代价：并发跑两次 acceptance 会互相踩。Phase 0 是串行里程碑，接受这个取舍。
  const handle = await startAcceptanceEnvironment({
    provider,
    model,
    runDirectory: evidenceDir,
    projectName: process.env.ACCEPTANCE_PROJECT_NAME ?? 'agent-server-acceptance-phase0',
  });
  try {
    const apiUrl = new URL(apiProbeUrl(handle));
    const rendered = await renderedComposeConfig(handle);
    const renderedPorts = parseYaml(rendered.stdout);
    const expectedPorts = expectedPortsFromEnvironment(rendered.environment);
    assertPreflight({ apiUrl: apiUrl.origin, renderedPorts, expectedPorts, effectiveProvider: rendered.environment.PASEO_PROVIDER, requestedProvider: provider });

    // 🔴 在把 URL 交给浏览器之前，先证明它真的在应答。
    const browserBaseUrl = `http://127.0.0.1:${handle.state.ports.webVite ?? 18081}`;
    // 预算必须覆盖【第一次】冷卷上的 pnpm install（固定 project 名之后只发生一次）。
    // ⛔ 这不是"调大阈值让它过"：超时仍然必须红，且等待时长会如实写进 ui-readiness.json，
    // 所以热卷那一跑如果还等很久，证据会直接暴露出来。
    const uiReadiness = await waitForHttpReady(browserBaseUrl, 900000);
    await writeFile(path.join(evidenceDir, 'ui-readiness.json'), JSON.stringify(uiReadiness, null, 2));

    const driverEnv = {
      ...process.env,
      PASEO_PROVIDER: provider,
      R2_EVIDENCE_DIR: evidenceDir,
      AGENT_SERVER_BASE_URL: apiUrl.origin,
      AGENT_SERVER_SERVICE_TOKEN: token,
      R2_BROWSER_BASE_URL: browserBaseUrl,
      R2_BROWSER_IMAGE: process.env.R2_BROWSER_IMAGE ?? 'agent-server-web-testing:r2',
      R2_BROWSER_SCRIPT_HOST: BROWSER_SCRIPT,
      R2_COMPOSE_PROJECT: handle.state.projectName,
    };
    const driver = await runDriver(driverEnv);
    await writeFile(path.join(evidenceDir, 'driver-stdout.log'), driver.stdout);
    await writeFile(path.join(evidenceDir, 'driver-stderr.log'), driver.stderr);
    if (driver.rc !== 0) throw new Error(`golden-eight driver exited rc=${driver.rc}; see driver-stderr.log`);

    // 独立复核，⛔ 不采信 driver 自报
    const step8 = JSON.parse(await readFile(path.join(evidenceDir, 'step8-observation.json'), 'utf8'));
    assertStep8Observation(step8);
    const observations = JSON.parse(await readFile(path.join(evidenceDir, 'final-sql-observations.json'), 'utf8'));
    assertFinalSql(deriveTerminalFacts(observations, step8.workRef));

    console.log(`PASS acceptance:run at HEAD=${report.head} provider=${provider}`);
  } finally {
    // 🔴 单步调试用：留栈不拆，⛔ 默认仍然拆（不留在这里当常态）。
    // Owner 指示"手动单步调试完，可以了再跑完整脚本" —— 一次性拆栈会把证据
    // 连同容器一起销毁，run3/run4 两次都是这样丢掉 docker logs 的。
    if (process.env.ACCEPTANCE_KEEP_STACK === '1') {
      console.log(`ACCEPTANCE_KEEP_STACK=1 — leaving ${handle.state.projectName} up for inspection`);
    } else {
      await handle.stop();
    }
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) await main();
