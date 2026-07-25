export type ChannelIngressKind = 'message' | 'card_action' | 'command';

export type ChannelIngressStatus =
  'pending' | 'processing' | 'processed' | 'failed';

export type ChannelActionScalar = string | number | boolean | null;

export type ChannelAction = Record<string, ChannelActionScalar>;

export type ChannelIngressInput = {
  readonly id: string;
  readonly connectionKey: string;
  readonly kind: ChannelIngressKind;
  readonly externalKey: string;
  readonly providerEventId?: string;
  readonly externalMessageId?: string;
  readonly chatId: string;
  readonly rootMessageId?: string;
  readonly threadId?: string;
  readonly replyToId?: string;
  readonly externalActorId?: string;
  /** Verified mention evidence; the next PostgreSQL batch must persist it. */
  readonly botMentionVerified?: boolean;
  readonly text?: string;
  readonly action?: ChannelAction;
  readonly normalizationVersion: string;
};

export type ChannelIngress = ChannelIngressInput & {
  readonly status: ChannelIngressStatus;
  readonly attemptCount: number;
  readonly leaseOwner?: string;
  readonly leaseExpiresAt?: string;
  readonly safeErrorCode?: string;
  readonly admittedSessionId?: string;
  readonly admittedTaskId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ChannelConversationBindingInput = {
  readonly id: string;
  readonly connectionKey: string;
  readonly chatId: string;
  readonly rootMessageId: string;
  readonly sessionId?: string;
  readonly creatingIngressId: string;
};

export type ChannelConversationBinding = ChannelConversationBindingInput & {
  readonly status: 'active' | 'closed';
  readonly createdAt: string;
  readonly updatedAt: string;
};
