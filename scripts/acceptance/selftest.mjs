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
import { expectedPortsFromEnvironment, deriveTerminalFacts } from './run.mjs';
import { parseServiceAccounts } from './credentials.mjs';

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

console.log('PASS acceptance:selftest (offline; no Compose, database, provider, or sandbox used)');
