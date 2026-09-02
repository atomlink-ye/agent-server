import type { ConversationAgentIdentityResolver } from '../work-organization/conversation-agent-identity.js';
import type { WhisperRepository } from '../ports/whisper-repository.js';
import type { WhisperChannel } from '../../domain/whisper/whisper-channel.js';
import type { WhisperMessage } from '../../domain/whisper/whisper-message.js';

export class WhisperCallerNotResolvedError extends Error {
  constructor() {
    super(
      'Unable to resolve the calling agent identity for this whisper request.',
    );
  }
}

export class WhisperInvalidPartnersError extends Error {
  constructor() {
    super('At least one distinct whisper partner is required.');
  }
}

export interface OpenWhisperRequest {
  readonly tenantId: string;
  /** The public conversation the agent was just replying in. */
  readonly callerConversationId: string;
  readonly partnerAgentDefinitionIds: readonly string[];
  readonly topic?: string | null;
  readonly openingMessage: string;
  readonly triggerMessageId?: string | null;
  readonly workRef?: string | null;
}

/**
 * The agent-initiated entry point for "I need to align with a teammate
 * privately." The caller's own identity is never taken from the request
 * body -- it is resolved from the conversation the runtime turn is
 * currently in, the same rule `work_item_claim` uses, so an agent can only
 * ever whisper as itself.
 */
export class OpenWhisper {
  constructor(
    private readonly repository: WhisperRepository,
    private readonly agentIdentities: ConversationAgentIdentityResolver,
  ) {}

  async execute(input: OpenWhisperRequest): Promise<{
    readonly channel: WhisperChannel;
    readonly message: WhisperMessage;
  }> {
    const initiatorAgentDefinitionId = await this.agentIdentities.resolve({
      tenantId: input.tenantId,
      conversationId: input.callerConversationId,
    });
    if (!initiatorAgentDefinitionId) throw new WhisperCallerNotResolvedError();

    const partnerAgentDefinitionIds = [
      ...new Set(input.partnerAgentDefinitionIds),
    ].filter((id) => id !== initiatorAgentDefinitionId);
    if (partnerAgentDefinitionIds.length === 0)
      throw new WhisperInvalidPartnersError();

    return this.repository.openWhisper({
      tenantId: input.tenantId,
      initiatorAgentDefinitionId,
      partnerAgentDefinitionIds,
      topic: input.topic ?? null,
      openingMessage: input.openingMessage,
      origin: {
        conversationId: input.callerConversationId,
        triggerMessageId: input.triggerMessageId ?? null,
        workRef: input.workRef ?? null,
      },
    });
  }
}
