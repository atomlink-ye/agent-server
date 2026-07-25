import type { ChannelConversationBinding } from './channel-event.js';

export type ChannelOutboxStatus =
  | 'pending'
  | 'sending'
  | 'retry_wait'
  | 'delivered'
  | 'permanent_failed'
  | 'delivery_unknown';

export type ChannelOutboxInput = {
  readonly id: string;
  readonly connectionKey: string;
  readonly bindingId: string | null;
  readonly targetId: string;
  readonly deliveryKind: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly payload: string;
  readonly providerRequestId: string;
};

export type ChannelOutbox = ChannelOutboxInput & {
  readonly status: ChannelOutboxStatus;
  readonly attemptCount: number;
  readonly leaseOwner?: string;
  readonly leaseExpiresAt?: string;
  readonly nextAttemptAt?: string;
  readonly lastSafeError?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ChannelDeliveryResult =
  'delivered' | 'retryable_failure' | 'permanent_failure' | 'unknown';

export type ChannelDeliveryAttemptInput = {
  readonly id: string;
  readonly outboxId: string;
  readonly attemptNumber: number;
  readonly providerRequestId?: string;
  readonly providerMessageId?: string;
  readonly result: ChannelDeliveryResult;
  readonly safeErrorCode?: string;
  readonly leaseOwner?: string;
};

export type ChannelDeliveryAttempt = ChannelDeliveryAttemptInput & {
  readonly createdAt: string;
};

export type ChannelBinding = ChannelConversationBinding;
