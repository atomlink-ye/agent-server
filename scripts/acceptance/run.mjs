import { startAcceptanceEnvironment, apiProbeUrl } from './lifecycle.mjs';
import { assertPreflight } from './preflight.mjs';

const provider = process.argv[2];
const model = process.argv[3];
if (!provider || !model) throw new Error('usage: acceptance:run <provider> <model>');

const handle = await startAcceptanceEnvironment({ provider, model });
try {
  const apiUrl = new URL(apiProbeUrl(handle));
  const renderedPorts = JSON.parse(process.env.ACCEPTANCE_RENDERED_PORTS_JSON ?? '{}');
  const expectedPorts = JSON.parse(process.env.ACCEPTANCE_EXPECTED_PORTS_JSON ?? '{}');
  assertPreflight({ apiUrl: apiUrl.origin, renderedPorts, expectedPorts, provider });
  throw new Error('golden-eight execution adapter must be supplied by the authorized acceptance invocation');
} finally {
  await handle.stop();
}
