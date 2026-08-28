import { AsyncLocalStorage } from 'node:async_hooks';

export type ExecutionTraceEntry = Readonly<{
  module: string;
  /** Product Run identity. Never a runtime turn id — the two must not be conflated. */
  runId?: string;
  /** Runtime turn identity, which the provider boundary sees instead of a Run id. */
  turnId?: string;
  terminalStatus?: string;
  fixtureId?: string;
}>;
const storage = new AsyncLocalStorage<ExecutionTraceEntry[]>();

export async function withExecutionTrace<T>(
  run: (trace: ExecutionTraceEntry[]) => Promise<T>,
): Promise<T> {
  const trace: ExecutionTraceEntry[] = [];
  return storage.run(trace, () => run(trace));
}

export function recordExecutionTrace(entry: ExecutionTraceEntry): void {
  storage.getStore()?.push(entry);
}
