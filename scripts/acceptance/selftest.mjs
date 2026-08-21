import assert from 'node:assert/strict';

import {
  assertLifecycleServices,
  assertProviderEffect,
  assertRenderedPorts,
  assertUniqueAccessibleLabel,
  latestRuntimeInitialized,
} from './assertions.mjs';
import { assertGoldenRecord, assertStep8Observation, goldenEight } from './golden-eight.mjs';
import { acceptanceRuntime } from './lifecycle.mjs';
import { assertFinalSql, assertPreflight } from './preflight.mjs';
import { expectedPortsFromEnvironment, deriveTerminalFacts, waitForHttpReady } from './run.mjs';
import { parseServiceAccounts } from './credentials.mjs';
import { assertGateReport } from './gate-report.mjs';

const expectedPorts = {
  postgres: { hostIp: '127.0.0.1', published: 32873, target: 5432 },
  'agent-server': { hostIp: '127.0.0.1', published: 40557, target: 3000 },
  web: { hostIp: '127.0.0.1', published: 46635, target: 3001 },
};
const rendered = {
  services: Object.fromEntries(Object.entries(expectedPorts).map(([name, value]) => [name, {
    ports: [{ host_ip: value.hostIp, published: String(value.published), target: value.target }],
  }])),
};
const profile = {
  runtime_adapter: 'paseo',
  runtime_provider: 'claude',
  runtime_model: 'opencode-go/deepseek-v4-flash',
};
const initializedLog = [
  'plain Docker prefix is ignored',
  JSON.stringify({ event: 'runtime.initialized', provider: 'claude', model: 'deepseek-v4-flash' }),
].join('\n');

function mutation(name, fn) {
  assert.throws(fn, Error, `${name} must be rejected`);
  console.log(`PASS mutation ${name}`);
}

// 🔴 assert.throws 只认【同步】抛出：async 函数返回的是一个 rejected promise，
// 它不会同步抛，所以异步谓词必须走这一条，⛔ 不要复用上面那个。
async function asyncMutation(name, fn) {
  await assert.rejects(fn, Error, `${name} must be rejected`);
  console.log(`PASS mutation ${name}`);
}

assertRenderedPorts(rendered, expectedPorts);
mutation('host IP', () => assertRenderedPorts({ services: { ...rendered.services, postgres: { ports: [{ host_ip: '0.0.0.0', published: '32873', target: 5432 }] } } }, expectedPorts));
mutation('published port', () => assertRenderedPorts({ services: { ...rendered.services, 'agent-server': { ports: [{ host_ip: '127.0.0.1', published: '40558', target: 3000 }] } } }, expectedPorts));
mutation('target port', () => assertRenderedPorts({ services: { ...rendered.services, web: { ports: [{ host_ip: '127.0.0.1', published: '46635', target: 3000 }] } } }, expectedPorts));
mutation('missing service', () => assertRenderedPorts({ services: { postgres: rendered.services.postgres, web: rendered.services.web } }, expectedPorts));
mutation('extra 16767 binding', () => assertRenderedPorts({ services: { ...rendered.services, 'agent-server': { ports: [...rendered.services['agent-server'].ports, { host_ip: '127.0.0.1', published: '16767', target: 3000 }] } } }, expectedPorts));

const initialized = latestRuntimeInitialized(initializedLog);
assertProviderEffect({ agentServer: profile, paseoRuntime: profile, runtimeInitialized: initialized, expectedProvider: 'claude' });
mutation('provider mismatch', () => assertProviderEffect({ agentServer: { ...profile, runtime_provider: 'opencode' }, paseoRuntime: { ...profile, runtime_provider: 'opencode' }, runtimeInitialized: { ...initialized, provider: 'opencode' }, expectedProvider: 'claude' }));
mutation('runtime model mismatch', () => assertProviderEffect({ agentServer: profile, paseoRuntime: profile, runtimeInitialized: { ...initialized, model: 'different-model' }, expectedProvider: 'claude' }));
mutation('missing runtime.initialized', () => latestRuntimeInitialized('{"event":"service.started"}'));
assertUniqueAccessibleLabel('<textarea aria-label="Message"></textarea>', 'Message');
mutation('Playwright strict label collision', () => assertUniqueAccessibleLabel('<textarea aria-label="Message"></textarea><button aria-label="Message"></button>', 'Message'));

const roles = { required: ['postgres', 'api'], oneShot: ['runner'] };
assertLifecycleServices({ postgres: { State: { Status: 'running', Health: { Status: 'healthy' } } }, api: { State: { Status: 'running' } }, runner: { State: { Status: 'exited', ExitCode: 0 } } }, roles);
mutation('failed one-shot service', () => assertLifecycleServices({ postgres: { State: { Status: 'running' } }, api: { State: { Status: 'running' } }, runner: { State: { Status: 'exited', ExitCode: 2 } } }, roles));
mutation('unhealthy required service', () => assertLifecycleServices({ postgres: { State: { Status: 'running', Health: { Status: 'unhealthy' } } }, api: { State: { Status: 'running' } }, runner: { State: { Status: 'exited', ExitCode: 0 } } }, roles));

const record = goldenEight.map((kind) => ({ kind }));
assertGoldenRecord(record);
mutation('golden eighth command', () => assertGoldenRecord([...record.slice(0, 7), { kind: 'browser:reload' }]));
const step8 = { maxWaitMs: 600000, postReturnedAt: '2026-01-01T00:00:00.000Z', actions: ['dom-read', 'passive-wait'], firstVisibleAt: '2026-01-01T00:00:03.000Z', workRef: 'work-1' };
assertStep8Observation(step8);
mutation('step-8 forbidden reload', () => assertStep8Observation({ ...step8, actions: ['dom-read', 'page.reload'] }));
mutation('step-8 card after T', () => assertStep8Observation({ ...step8, postReturnedAt: '2026-01-01T00:00:00.000Z', firstVisibleAt: '2026-01-01T00:11:40.000Z' }));

assertPreflight({ apiUrl: 'http://127.0.0.1:40557', renderedPorts: rendered, expectedPorts, requestedProvider: 'claude', effectiveProvider: 'claude' });
mutation('preflight non-loopback URL', () => assertPreflight({ apiUrl: 'http://localhost:40557', renderedPorts: rendered, expectedPorts, requestedProvider: 'claude', effectiveProvider: 'claude' }));
mutation('preflight rendered port mismatch', () => assertPreflight({ apiUrl: 'http://127.0.0.1:40557', renderedPorts: { services: { ...rendered.services, 'agent-server': { ports: [{ host_ip: '127.0.0.1', published: '32783', target: 3000 }] } } }, expectedPorts, requestedProvider: 'claude', effectiveProvider: 'claude' }));
const handleFixture = { state: { ports: { postgres: 41001, api: 41002, web: 41003 } } };
const renderedFixture = `services:\n  postgres:\n    ports: [{host_ip: 127.0.0.1, published: \"41001\", target: 5432}]\n  agent-server:\n    ports: [{host_ip: 127.0.0.1, published: \"41002\", target: 3000}]\n  web:\n    ports: [{host_ip: 127.0.0.1, published: \"41003\", target: 3001}]`;
assertFinalSql({ provider: 'claude', workRef: 'work-1', workRun: 'run-1', workStatus: 'completed' });
mutation('terminal SQL missing work_ref', () => assertFinalSql({ provider: 'claude', workRun: 'run-1', workStatus: 'completed' }));
mutation('terminal SQL failed Work', () => assertFinalSql({ provider: 'claude', workRef: 'work-1', workRun: 'run-1', workStatus: 'failed' }));

assert.deepEqual(acceptanceRuntime('claude', 'deepseek-v4-flash'), { adapter: 'paseo', provider: 'claude', model: 'deepseek-v4-flash' });
mutation('implicit provider', () => acceptanceRuntime('', 'deepseek-v4-flash'));


// --- R4 Manager 追加：凭据解析与终局事实推导的变异对偶 ---
const goodAccounts = JSON.stringify([{ token: 't1', serviceAccountId: 'sa', tenantId: 'tn' }]);
assert.equal(parseServiceAccounts(goodAccounts).token, 't1');
mutation('SERVICE_ACCOUNTS_JSON quote-stripped by shell source', () => parseServiceAccounts('[{token:t1}]'));
mutation('SERVICE_ACCOUNTS_JSON empty', () => parseServiceAccounts(''));
mutation('SERVICE_ACCOUNTS_JSON empty array', () => parseServiceAccounts('[]'));
mutation('SERVICE_ACCOUNTS_JSON token missing', () => parseServiceAccounts(JSON.stringify([{ serviceAccountId: 'sa' }])));

// 🔴 形状对齐真实表：works 无 status 列；终局状态来自 tasks（work_runs.root_task_id -> tasks.status）
const goodObs = { messages: [{ provider: 'claude', work_ref: 'w1' }], works: [{ id: 'w1', origin: 'created' }], runs: [{ id: 'r1', work_id: 'w1' }], tasks: [{ id: 't1', status: 'completed', work_id: 'w1' }] };
assert.equal(deriveTerminalFacts(goodObs, 'w1').workStatus, 'completed');
mutation('terminal facts messages not observed', () => deriveTerminalFacts({ ...goodObs, messages: [] }, 'w1'));
mutation('terminal facts no work_ref observed', () => deriveTerminalFacts({ ...goodObs, messages: [{ provider: 'claude' }] }, 'w1'));
mutation('terminal facts works not observed', () => deriveTerminalFacts({ messages: goodObs.messages, runs: goodObs.runs }, 'w1'));
mutation('terminal facts work_runs not observed', () => deriveTerminalFacts({ messages: goodObs.messages, works: goodObs.works }, 'w1'));


// --- R4: expected 必须来自 lifecycle environment，⛔ 不许来自 handle（否则判据自证）---
const envFull = { AGENT_SERVER_TEST_POSTGRES_PORT: '41001', AGENT_SERVER_TEST_API_PORT: '41002', AGENT_SERVER_TEST_WEB_PORT: '41003' };
assert.equal(expectedPortsFromEnvironment(envFull)['agent-server'].published, 41002);
mutation('lifecycle env missing web port export', () => expectedPortsFromEnvironment({ AGENT_SERVER_TEST_POSTGRES_PORT: '41001', AGENT_SERVER_TEST_API_PORT: '41002' }));
mutation('lifecycle env missing api port export', () => expectedPortsFromEnvironment({ AGENT_SERVER_TEST_POSTGRES_PORT: '41001', AGENT_SERVER_TEST_WEB_PORT: '41003' }));
mutation('lifecycle env exports nothing', () => expectedPortsFromEnvironment({}));

// --- R4: preflight 的 provider 必须建立关系，⛔ 不许只验非空 ---
const renderedFor = (p) => ({ services: { 'agent-server': { ports: [{ host_ip: '127.0.0.1', published: String(p), target: 3000 }] } } });
assertPreflight({ apiUrl: 'http://127.0.0.1:41002', renderedPorts: renderedFor(41002), expectedPorts: expectedPortsFromEnvironment(envFull), requestedProvider: 'claude', effectiveProvider: 'claude' });
mutation('preflight requested/effective provider mismatch', () => assertPreflight({ apiUrl: 'http://127.0.0.1:41002', renderedPorts: renderedFor(41002), expectedPorts: expectedPortsFromEnvironment(envFull), requestedProvider: 'claude', effectiveProvider: 'opencode' }));
mutation('preflight effective provider not observed', () => assertPreflight({ apiUrl: 'http://127.0.0.1:41002', renderedPorts: renderedFor(41002), expectedPorts: expectedPortsFromEnvironment(envFull), requestedProvider: 'claude' }));
mutation('preflight rendered vs lifecycle env port divergence', () => assertPreflight({ apiUrl: 'http://127.0.0.1:41002', renderedPorts: renderedFor(41004), expectedPorts: expectedPortsFromEnvironment(envFull), requestedProvider: 'claude', effectiveProvider: 'claude' }));

// --- R4: 终局事实的关联必须被证明 ---
const rel = { messages: [{ provider: 'claude', work_ref: 'w1' }], works: [{ id: 'w1', origin: 'created' }], runs: [{ id: 'r1', work_id: 'w1' }], tasks: [{ id: 't1', status: 'completed', work_id: 'w1' }] };
assert.equal(deriveTerminalFacts(rel, 'w1').workRun, 'r1');
mutation('observed workRef not supplied', () => deriveTerminalFacts(rel));
mutation('observed workRef has no carrying message', () => deriveTerminalFacts(rel, 'bogus'));
mutation('work has no matching work_run', () => deriveTerminalFacts({ ...rel, runs: [{ id: 'r9', work_id: 'other' }] }, 'w1'));

// 🔴 Auditor finding-1-e09f1b9a 的原始反例：同一会话里有旧的已完成 Work 与新的失败 Work。
// 认证的必须是 step-8 在 DOM 里看到的那一个，⛔ 不许退回去认证更早的那个。
const twoWorks = {
  messages: [{ provider: 'claude', work_ref: 'old-complete' }, { provider: 'claude', work_ref: 'new-visible' }],
  works: [{ id: 'old-complete', origin: 'created' }, { id: 'new-visible', origin: 'created' }],
  runs: [{ id: 'run-old', work_id: 'old-complete' }, { id: 'run-new', work_id: 'new-visible' }],
  tasks: [{ id: 't-old', status: 'completed', work_id: 'old-complete' }, { id: 't-new', status: 'failed', work_id: 'new-visible' }],
};
assert.equal(deriveTerminalFacts(twoWorks, 'old-complete').workStatus, 'completed');
assert.equal(deriveTerminalFacts(twoWorks, 'new-visible').workStatus, 'failed');
mutation('screen shows failed Work while an earlier Work is complete', () => assertFinalSql(deriveTerminalFacts(twoWorks, 'new-visible')));


// --- R4: 浏览器入口的闸门（容器内没有 git，只能核验挂进来的报告）---
// 🔴 每一条都必须能红。绿的那条在最前面，作为"这个谓词不是恒红"的对偶。
const goodReport = { ok: true, head: 'ffd9359c9', dirty: 'no', failed: [], results: [] };
assert.equal(assertGateReport(goodReport, 'ffd9359c9').head, 'ffd9359c9');
mutation('gate report says not ok', () => assertGateReport({ ...goodReport, ok: false, failed: ['CLEAN'] }, 'ffd9359c9'));
mutation('gate report ok is truthy but not true', () => assertGateReport({ ...goodReport, ok: 'yes' }, 'ffd9359c9'));
mutation('gate report head is unavailable', () => assertGateReport({ ...goodReport, head: 'unavailable' }, 'ffd9359c9'));
mutation('gate report head is empty', () => assertGateReport({ ...goodReport, head: '   ' }, 'ffd9359c9'));
mutation('gate report was produced against a dirty worktree', () => assertGateReport({ ...goodReport, dirty: '3 path(s)' }, 'ffd9359c9'));
mutation('gate report lists failures despite ok', () => assertGateReport({ ...goodReport, failed: ['P3'] }, 'ffd9359c9'));
// 🔴 这条是本次改动的要害：挂一份【别的装置】的旧报告必须红。
mutation('gate report belongs to a different HEAD', () => assertGateReport(goodReport, '2ef2a5e'));
mutation('expected HEAD was not supplied', () => assertGateReport(goodReport, undefined));
mutation('expected HEAD is blank', () => assertGateReport(goodReport, '  '));
mutation('gate report is not an object', () => assertGateReport(null, 'ffd9359c9'));


// --- R4: UI 就绪等待（离线，用注入的 fetch/clock，⛔ 不碰真实网络）---
// 绿的一条：第 3 次尝试才应答，必须返回 ready 并如实记下等了多久。
{
  let clock = 0;
  const tick = () => (clock += 2000);
  let calls = 0;
  const flaky = async () => {
    calls += 1;
    if (calls < 3) throw new Error('connect ECONNREFUSED');
    return { status: 200 };
  };
  const result = await waitForHttpReady('http://127.0.0.1:18081', 120000, { intervalMs: 0, now: () => clock, fetchImpl: async (u) => { const r = await flaky(u); tick(); return r; } });
  assert.equal(result.ready, true);
  assert.equal(result.attempts, 3);
  assert.equal(result.status, 200);
}
// 🔴 对偶：一直不应答必须【红】，⛔ 不许超时后静默放行。
{
  let clock = 0;
  await asyncMutation('UI never answers within the budget', async () =>
    waitForHttpReady('http://127.0.0.1:18081', 10000, {
      intervalMs: 0,
      now: () => (clock += 2000),
      fetchImpl: async () => { throw new Error('connect ECONNREFUSED'); },
    }));
}

console.log('PASS acceptance:selftest (offline; no Compose, database, provider, or sandbox used)');
