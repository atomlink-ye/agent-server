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
const step8 = { maxWaitMs: 600000, postReturnedAt: 't0', actions: ['dom-read', 'passive-wait'], firstVisibleAt: 't1', workRef: 'work-1' };
assertStep8Observation(step8);
mutation('step-8 forbidden reload', () => assertStep8Observation({ ...step8, actions: ['dom-read', 'page.reload'] }));

assertPreflight({ apiUrl: 'http://127.0.0.1:40557', renderedPorts: rendered, expectedPorts, provider: 'claude' });
mutation('preflight non-loopback URL', () => assertPreflight({ apiUrl: 'http://localhost:40557', renderedPorts: rendered, expectedPorts, provider: 'claude' }));
assertFinalSql({ provider: 'claude', workRef: 'work-1', workRun: 'run-1', workStatus: 'complete' });
mutation('terminal SQL missing work_ref', () => assertFinalSql({ provider: 'claude', workRun: 'run-1', workStatus: 'complete' }));

assert.deepEqual(acceptanceRuntime('claude', 'deepseek-v4-flash'), { adapter: 'paseo', provider: 'claude', model: 'deepseek-v4-flash' });
mutation('implicit provider', () => acceptanceRuntime('', 'deepseek-v4-flash'));

console.log('PASS acceptance:selftest (offline; no Compose, database, provider, or sandbox used)');
