/**
 * Entrypoint-facing export. Composition is intentionally left to the host
 * because the work/conversation link resolver is not available in this lane.
 */
export {
  createWorkChatWakeWorker,
  WorkChatWakeWorker,
} from '../../application/work-chat/work-chat-wake-worker.js';
export type {
  WorkChatConversationLink,
  WorkChatConversationResolver,
  WorkChatWakeWorkerDependencies,
  WorkChatWakeWorkerOptions,
  WorkChatWakeWorkSource,
} from '../../application/work-chat/work-chat-wake-worker.js';
export type {
  WorkChatWakeStateRepository,
  WorkChatWakeWorkKey,
} from '../../application/work-chat/work-chat-wake-state-repository.js';
