import {
  createAgentServerHarness,
  type AgentServerHarness,
} from './agent-server-harness.js';

export async function withAgentServerHarness<T>(
  run: (harness: AgentServerHarness) => Promise<T>,
): Promise<T> {
  const harness = await createAgentServerHarness();
  try {
    return await run(harness);
  } finally {
    await harness.dispose();
  }
}
