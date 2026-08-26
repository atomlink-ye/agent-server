import type { Pool } from 'pg';
import type { RunDispatcher } from '../application/ports/run-dispatcher.js';
import type { RuntimeExecutionProvider } from '../application/ports/runtime-execution-provider.js';
import type { RuntimeMcpServer } from '../infrastructure/extensions/runtime-mcp-server.js';
import type { WorkerSet } from './create-workers.js';
import { createLifecycleSupervisor } from './lifecycle-supervisor.js';

/** Composes only process lifecycle resources; application graph ownership stays outside. */
export function createApplicationLifecycle(input: {
  readonly dispatcher: Pick<RunDispatcher, 'start' | 'stop'>;
  readonly workers: WorkerSet;
  readonly runtimeProvider: Pick<
    RuntimeExecutionProvider,
    'ensureReady' | 'health' | 'close'
  >;
  readonly runtimeEnabled: boolean;
  readonly runtimeMcpServer: Pick<RuntimeMcpServer, 'stop'>;
  readonly pool: Pick<Pool, 'end'>;
}) {
  return createLifecycleSupervisor({
    dispatcher: input.dispatcher,
    ...input.workers,
    runtimeProvider: input.runtimeProvider,
    runtimeEnabled: input.runtimeEnabled,
    runtimeMcpServer: input.runtimeMcpServer,
    pool: input.pool,
  });
}
