/** Entrypoint-facing exports; the host supplies the scoped link repository. */
export {
  createWorkChatConversationResolver,
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
