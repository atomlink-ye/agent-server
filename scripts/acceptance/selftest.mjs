import assert from 'node:assert/strict';

import {
  assertLifecycleServices,
  assertProviderEffect,
  assertRenderedPorts,
  latestRuntimeInitialized,
  serviceHealth,
} from './assertions.mjs';
import { acceptanceRuntime } from './lifecycle.mjs';

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

assert.equal(serviceHealth({ State: { Status: 'running' } }), 'no-healthcheck');
assertLifecycleServices({ postgres: { State: { Status: 'running', Health: { Status: 'healthy' } } }, runner: { State: { Status: 'running' } } });
mutation('unhealthy required service', () => assertLifecycleServices({ runner: { State: { Status: 'exited', ExitCode: 2 } }, api: { State: { Status: 'running', Health: { Status: 'healthy' } } } }));

assert.deepEqual(acceptanceRuntime('claude', 'deepseek-v4-flash'), { adapter: 'paseo', provider: 'claude', model: 'deepseek-v4-flash' });
mutation('implicit provider', () => acceptanceRuntime('', 'deepseek-v4-flash'));

console.log('PASS acceptance:selftest (offline; no Compose, database, provider, or sandbox used)');
