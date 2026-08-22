import type { ChatActivationCause } from '../../domain/chat/chat-activation.js';

export type ChatActivationPriority = 'normal' | 'urgent';

export interface ChatDispatch {
  readonly id: string;
  readonly tenantId: string;
  readonly agentDefinitionId: string;
  readonly conversationId: string;
  readonly throughSequence: number;
  /** Durable identity of the event that first opened this activation. */
  readonly dedupeKey: string;
  /** Stable Agent/Conversation key used to coalesce an unclaimed burst. */
  readonly activationKey: string;
  readonly priority: ChatActivationPriority;
  readonly causes: readonly ChatActivationCause[];
  readonly availableAt: string;
  readonly createdAt: string;
  readonly publishedAt: string | null;
}

export interface ChatDispatchRepository {
  enqueue(input: {
    readonly tenantId: string;
    readonly agentDefinitionId: string;
    readonly conversationId: string;
    readonly throughSequence: number;
    readonly dedupeKey: string;
    readonly cause?: ChatActivationCause;
    readonly priority?: ChatActivationPriority;
    /** Short burst-coalescing window. Zero preserves immediate legacy behavior. */
    readonly debounceMs?: number;
  }): Promise<{ readonly enqueued: boolean; readonly dispatchId?: string }>;

  listPending(limit: number): Promise<readonly ChatDispatch[]>;

  claimNext(workerId: string, leaseMs: number): Promise<ChatDispatch | null>;

  completeClaim(input: {
    readonly id: string;
    readonly workerId: string;
    readonly publishedAt: string;
  }): Promise<boolean>;

  /** Release a failed activation without publishing or consuming its causes. */
  releaseClaim(input: {
    readonly id: string;
    readonly workerId: string;
  }): Promise<boolean>;

  markPublished(id: string, publishedAt: string): Promise<void>;

  getRuntimeWatermark(input: {
    readonly agentChatRuntimeId: string;
    readonly runtimeEpoch: number;
    readonly tenantId: string;
    readonly conversationId: string;
  }): Promise<number>;

  /** Monotonic; callers advance only after durable reply materialization. */
  advanceRuntimeWatermark(input: {
    readonly agentChatRuntimeId: string;
    readonly runtimeEpoch: number;
    readonly tenantId: string;
    readonly conversationId: string;
    readonly throughSequence: number;
  }): Promise<number>;
}
