import type { ChatDeliveryWorker } from '../entrypoints/chat/worker.js';
import type { LarkIngressWorker } from '../entrypoints/lark/worker.js';
import type { LarkOutboxWorker } from '../entrypoints/lark/outbox-worker.js';
import type { WorkChatWakeWorker } from '../entrypoints/work-chat/worker.js';
import type { createLarkWebsocketReceiver } from '../adapters/lark/lark-websocket-receiver.js';

/** Worker values created by capability factories and started by the supervisor. */
export interface WorkerSet {
  readonly larkWorker?: LarkIngressWorker;
  readonly larkOutboxWorker?: LarkOutboxWorker;
  readonly chatWorker?: ChatDeliveryWorker;
  readonly workChatWorker?: WorkChatWakeWorker;
  readonly larkReceiver?: ReturnType<typeof createLarkWebsocketReceiver>;
}

export function createWorkers(workers: WorkerSet): WorkerSet {
  return Object.freeze({ ...workers });
}
