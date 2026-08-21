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
export function deriveTerminalFacts(observations) {
  const messages = observations?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('final SQL observations: messages not observed');
  }
  const agentWithRef = messages.filter((m) => m.work_ref);
  if (agentWithRef.length === 0) throw new Error('final SQL observations: no message carrying work_ref was observed');
  const works = observations?.works;
  if (!Array.isArray(works) || works.length === 0) throw new Error('final SQL observations: works not observed');
  const runs = observations?.runs;
  if (!Array.isArray(runs) || runs.length === 0) throw new Error('final SQL observations: work_runs not observed');
  return {
    provider: agentWithRef[0].provider,
    workRef: agentWithRef[0].work_ref,
    workRun: runs[0].id,
    workStatus: works[0].status,
  };
}

export function acceptancePortFacts(handle, composeConfig) {
  const ports = handle.state.ports;
  if (!ports.api || !ports.postgres || !ports.web) throw new Error('lifecycle did not allocate all acceptance ports');
  return {
    renderedPorts: parseYaml(composeConfig),
    expectedPorts: {
      postgres: { hostIp: '127.0.0.1', published: ports.postgres, target: 5432 },
      'agent-server': { hostIp: '127.0.0.1', published: ports.api, target: 3000 },
      web: { hostIp: '127.0.0.1', published: ports.web, target: 3001 },
    },
  };
}

async function renderedComposeConfig(handle) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { composeArgumentsForLocalEnvironment } = await import('../../tooling/environment/lifecycle.ts');
  const run = promisify(execFile);
  const environment = {
    ...process.env,
    AGENT_SERVER_TEST_POSTGRES_PORT: String(handle.state.ports.postgres),
    AGENT_SERVER_TEST_API_PORT: String(handle.state.ports.api),
    AGENT_SERVER_TEST_WEB_PORT: String(handle.state.ports.web),
  };
  const args = await composeArgumentsForLocalEnvironment(handle.state, environment);
  const result = await run('docker', [...args, 'config'], { env: environment });
  return result.stdout;
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

  const handle = await startAcceptanceEnvironment({ provider, model, runDirectory: evidenceDir });
  try {
    const apiUrl = new URL(apiProbeUrl(handle));
    const { renderedPorts, expectedPorts } = acceptancePortFacts(handle, await renderedComposeConfig(handle));
    assertPreflight({ apiUrl: apiUrl.origin, renderedPorts, expectedPorts, provider });

    const driverEnv = {
      ...process.env,
      PASEO_PROVIDER: provider,
      R2_EVIDENCE_DIR: evidenceDir,
      AGENT_SERVER_BASE_URL: apiUrl.origin,
      AGENT_SERVER_SERVICE_TOKEN: token,
      R2_BROWSER_BASE_URL: `http://127.0.0.1:${handle.state.ports.webVite ?? 18081}`,
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
    assertFinalSql(deriveTerminalFacts(observations));

    console.log(`PASS acceptance:run at HEAD=${report.head} provider=${provider}`);
  } finally {
    await handle.stop();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) await main();
