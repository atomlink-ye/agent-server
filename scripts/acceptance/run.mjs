import { startAcceptanceEnvironment, apiProbeUrl } from './lifecycle.mjs';
import { parse as parseYaml } from 'yaml';
import { assertPreflight } from './preflight.mjs';

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
  if (!provider || !model) throw new Error('usage: acceptance:run <provider> <model>');
  const handle = await startAcceptanceEnvironment({ provider, model });
  try {
  const apiUrl = new URL(apiProbeUrl(handle));
  const { renderedPorts, expectedPorts } = acceptancePortFacts(handle, await renderedComposeConfig(handle));
  assertPreflight({ apiUrl: apiUrl.origin, renderedPorts, expectedPorts, provider });
  throw new Error('golden-eight execution adapter must be supplied by the authorized acceptance invocation');
  } finally {
    await handle.stop();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) await main();
