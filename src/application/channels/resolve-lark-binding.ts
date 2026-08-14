import type {
  AccessContext,
  ServiceAccountAccessContext,
} from '../../platform/access-context.js';
import type { LarkCanaryEnabledConfig } from '../../shared/config.js';
import type {
  ChannelConversationBinding,
  ChannelIngress,
} from '../../domain/channels/channel-event.js';

export type LarkBindingKey = {
  readonly connectionKey: string;
  readonly chatId: string;
  readonly rootMessageId: string;
};

export type LarkBindingSessionResolutionInput = LarkBindingKey & {
  readonly creatingIngressId: string;
  readonly createIfMissing: boolean;
  readonly owner: AccessContext;
  readonly publishedAgentVersionId: string;
};

export interface LarkBindingSessionPort {
  findBinding(
    input: LarkBindingKey,
  ): Promise<{ readonly id: string; readonly sessionId?: string } | null>;
  /** The PostgreSQL batch must elect the binding before creating its Session. */
  resolveBindingWithSession(input: LarkBindingSessionResolutionInput): Promise<{
    readonly binding: ChannelConversationBinding;
    readonly sessionId: string;
    readonly created: boolean;
  }>;
}

export type LarkBindingResult =
  | {
      readonly accepted: true;
      readonly binding: ChannelConversationBinding;
      readonly sessionId: string;
      readonly created: boolean;
    }
  | {
      readonly accepted: false;
      readonly reason:
        | 'connection_not_allowed'
        | 'chat_not_allowed'
        | 'user_not_allowed'
        | 'unsupported_ingress'
        | 'missing_message_id'
        | 'bot_mention_required';
    };

export class ResolveLarkBinding {
  public constructor(
    private readonly bindings: LarkBindingSessionPort,
    private readonly config: LarkCanaryEnabledConfig,
  ) {}

  public async execute(ingress: ChannelIngress): Promise<LarkBindingResult> {
    if (ingress.connectionKey !== this.config.connectionKey) {
      return { accepted: false, reason: 'connection_not_allowed' };
    }
    if (ingress.kind !== 'message') {
      return { accepted: false, reason: 'unsupported_ingress' };
    }
    if (ingress.chatId !== this.config.allowedChatId) {
      return { accepted: false, reason: 'chat_not_allowed' };
    }
    if (ingress.externalActorId !== this.config.allowedOpenId) {
      return { accepted: false, reason: 'user_not_allowed' };
    }
    const rootMessageId = ingress.rootMessageId ?? ingress.externalMessageId;
    if (!rootMessageId) {
      return { accepted: false, reason: 'missing_message_id' };
    }
    const key = {
      connectionKey: this.config.connectionKey,
      chatId: ingress.chatId,
      rootMessageId,
    };
    const existing = await this.bindings.findBinding(key);
    const createIfMissing = existing === null;
    if (createIfMissing && ingress.botMentionVerified !== true) {
      return { accepted: false, reason: 'bot_mention_required' };
    }

    const resolved = await this.bindings.resolveBindingWithSession({
      ...key,
      creatingIngressId: ingress.id,
      createIfMissing,
      owner: ownerFromLarkCanary(this.config),
      publishedAgentVersionId: this.config.publishedAgentVersionId,
    });
    return {
      accepted: true,
      binding: resolved.binding,
      sessionId: resolved.sessionId,
      created: resolved.created,
    };
  }
}

export function ownerFromLarkCanary(
  config: LarkCanaryEnabledConfig,
): ServiceAccountAccessContext {
  return {
    tenantId: config.tenantId,
    workspaceId: config.workspaceId,
    principalType: 'service_account',
    principalId: config.serviceAccountId,
    serviceAccountId: config.serviceAccountId,
    policySnapshotVersion: config.policyVersion,
  };
}
