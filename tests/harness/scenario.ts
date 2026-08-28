import {
  createAgentServerHarness,
  type AgentServerHarness,
} from './agent-server-harness.js';
import {
  withExecutionTrace,
  type ExecutionTraceEntry,
} from '../../src/shared/observability/execution-trace.js';

/** The harness plus the ordered trace recorded while the scenario ran. */
export type TracedAgentServerHarness = AgentServerHarness & {
  readonly trace: readonly ExecutionTraceEntry[];
};

export async function withAgentServerHarness<T>(
  run: (harness: TracedAgentServerHarness) => Promise<T>,
  options?: Parameters<typeof createAgentServerHarness>[0],
): Promise<T> {
  return withExecutionTrace(async (trace) => {
    const harness = await createAgentServerHarness(options);
    try {
      return await run({ ...harness, trace });
    } finally {
      await harness.dispose();
    }
  });
}
