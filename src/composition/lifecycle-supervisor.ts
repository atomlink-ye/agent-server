import type { ExecutionRuntimeService } from '../application/ports/execution-runtime.js';
import type { RunDispatcher } from '../application/ports/run-dispatcher.js';
import type { ChatDeliveryWorker } from '../entrypoints/chat/worker.js';
import type { LarkIngressWorker } from '../entrypoints/lark/worker.js';
import type { LarkOutboxWorker } from '../entrypoints/lark/outbox-worker.js';
import type { WorkChatWakeWorker } from '../entrypoints/work-chat/worker.js';
import type { createLarkWebsocketReceiver } from '../adapters/lark/lark-websocket-receiver.js';

export interface LifecycleResources {
  readonly dispatcher: Pick<RunDispatcher, 'stop'>;
  readonly larkWorker?: Pick<LarkIngressWorker, 'stop'>;
  readonly larkOutboxWorker?: Pick<LarkOutboxWorker, 'stop'>;
  readonly chatWorker?: Pick<ChatDeliveryWorker, 'stop'>;
  readonly workChatWorker?: Pick<WorkChatWakeWorker, 'stop'>;
  readonly larkReceiver?: Pick<
    ReturnType<typeof createLarkWebsocketReceiver>,
    'stop'
  >;
  readonly runtime: Pick<ExecutionRuntimeService, 'close'>;
  readonly runtimeMcpServer?: { stop(): Promise<void> };
  readonly pool: { end(): Promise<void> };
}

export type StartableLifecycleResources = LifecycleResources & {
  readonly dispatcher: Pick<RunDispatcher, 'start' | 'stop'>;
  readonly larkWorker?: Pick<LarkIngressWorker, 'start' | 'stop'>;
  readonly larkOutboxWorker?: Pick<LarkOutboxWorker, 'start' | 'stop'>;
  readonly chatWorker?: Pick<ChatDeliveryWorker, 'start' | 'stop'>;
  readonly workChatWorker?: Pick<WorkChatWakeWorker, 'start' | 'stop'>;
  readonly larkReceiver?: Pick<
    ReturnType<typeof createLarkWebsocketReceiver>,
    'start' | 'stop'
  >;
};

export interface LifecycleSupervisor {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** Owns process start-up and reverse-order shutdown for one application graph. */
export function createLifecycleSupervisor(
  resources: StartableLifecycleResources,
): LifecycleSupervisor {
  return Object.freeze({
    start: () => startServiceResources(resources),
    stop: () => closeServiceResources(resources),
  });
}

export async function closeServiceResources(
  resources: LifecycleResources,
): Promise<void> {
  const failures: Error[] = [];
  await cleanup(
    'lark receiver',
    resources.larkReceiver ? () => resources.larkReceiver!.stop() : undefined,
    failures,
  );
  await cleanup(
    'lark worker',
    resources.larkWorker ? () => resources.larkWorker!.stop() : undefined,
    failures,
  );
  await cleanup(
    'lark outbox worker',
    resources.larkOutboxWorker
      ? () => resources.larkOutboxWorker!.stop()
      : undefined,
    failures,
  );
  await cleanup(
    'chat worker',
    resources.chatWorker ? () => resources.chatWorker!.stop() : undefined,
    failures,
  );
  await cleanup(
    'work chat worker',
    resources.workChatWorker
      ? () => resources.workChatWorker!.stop()
      : undefined,
    failures,
  );
  await cleanup('dispatcher', () => resources.dispatcher.stop(), failures);
  await cleanup('runtime', () => resources.runtime.close(), failures);
  await cleanup(
    'runtime MCP server',
    resources.runtimeMcpServer
      ? () => resources.runtimeMcpServer!.stop()
      : undefined,
    failures,
  );
  await cleanup('pool', () => resources.pool.end(), failures);
  throwFailures(failures, 'service shutdown failed');
}

export async function startServiceResources(
  resources: StartableLifecycleResources,
): Promise<void> {
  try {
    resources.dispatcher.start();
    await resources.larkReceiver?.start();
    resources.larkWorker?.start();
    resources.larkOutboxWorker?.start();
    resources.chatWorker?.start();
    resources.workChatWorker?.start();
  } catch (error: unknown) {
    const startupFailure = lifecycleError('service startup');
    try {
      await closeServiceResources(resources);
    } catch (cleanupError: unknown) {
      throw new AggregateError(
        [startupFailure, cleanupError],
        'service startup failed',
      );
    }
    throw startupFailure;
  }
}

export async function closeRuntimeAndPool(
  runtime: Pick<ExecutionRuntimeService, 'close'>,
  pool: { end(): Promise<void> },
): Promise<void> {
  const failures: Error[] = [];
  await cleanup('runtime', () => runtime.close(), failures);
  await cleanup('pool', () => pool.end(), failures);
  throwFailures(failures, 'startup cleanup failed');
}

async function cleanup(
  label: string,
  operation: (() => Promise<void>) | undefined,
  failures: Error[],
): Promise<void> {
  if (!operation) return;
  try {
    await operation();
  } catch {
    failures.push(lifecycleError(label));
  }
}

function throwFailures(failures: readonly Error[], message: string): void {
  if (failures.length === 0) return;
  if (failures.length === 1) throw failures[0];
  throw new AggregateError(failures, message);
}

function lifecycleError(label: string): Error {
  const safe = new Error(`${label} failed`);
  safe.name = 'ServiceLifecycleError';
  return safe;
}
