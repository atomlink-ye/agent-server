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
import { acceptancePortFacts, deriveTerminalFacts } from './run.mjs';
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

assertPreflight({ apiUrl: 'http://127.0.0.1:40557', renderedPorts: rendered, expectedPorts, provider: 'claude' });
mutation('preflight non-loopback URL', () => assertPreflight({ apiUrl: 'http://localhost:40557', renderedPorts: rendered, expectedPorts, provider: 'claude' }));
mutation('preflight rendered port mismatch', () => assertPreflight({ apiUrl: 'http://127.0.0.1:40557', renderedPorts: { services: { ...rendered.services, 'agent-server': { ports: [{ host_ip: '127.0.0.1', published: '32783', target: 3000 }] } } }, expectedPorts, provider: 'claude' }));
const handleFixture = { state: { ports: { postgres: 41001, api: 41002, web: 41003 } } };
const renderedFixture = `services:\n  postgres:\n    ports: [{host_ip: 127.0.0.1, published: \"41001\", target: 5432}]\n  agent-server:\n    ports: [{host_ip: 127.0.0.1, published: \"41002\", target: 3000}]\n  web:\n    ports: [{host_ip: 127.0.0.1, published: \"41003\", target: 3001}]`;
const portFacts = acceptancePortFacts(handleFixture, renderedFixture);
assertPreflight({ apiUrl: 'http://127.0.0.1:41002', ...portFacts, provider: 'claude' });
mutation('handle rendered port divergence', () => assertPreflight({ apiUrl: 'http://127.0.0.1:41002', ...acceptancePortFacts(handleFixture, renderedFixture.replace('41002', '41004')), provider: 'claude' }));
assertFinalSql({ provider: 'claude', workRef: 'work-1', workRun: 'run-1', workStatus: 'complete' });
mutation('terminal SQL missing work_ref', () => assertFinalSql({ provider: 'claude', workRun: 'run-1', workStatus: 'complete' }));
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

const goodObs = { messages: [{ provider: 'claude', work_ref: 'wr1' }], works: [{ id: 'w1', status: 'complete' }], runs: [{ id: 'r1' }] };
assert.equal(deriveTerminalFacts(goodObs).workStatus, 'complete');
mutation('terminal facts messages not observed', () => deriveTerminalFacts({ ...goodObs, messages: [] }));
mutation('terminal facts no work_ref observed', () => deriveTerminalFacts({ ...goodObs, messages: [{ provider: 'claude' }] }));
mutation('terminal facts works not observed', () => deriveTerminalFacts({ messages: goodObs.messages, runs: goodObs.runs }));
mutation('terminal facts work_runs not observed', () => deriveTerminalFacts({ messages: goodObs.messages, works: goodObs.works }));

console.log('PASS acceptance:selftest (offline; no Compose, database, provider, or sandbox used)');
