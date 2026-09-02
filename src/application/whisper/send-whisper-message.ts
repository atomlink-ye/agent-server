import type { ConversationAgentIdentityResolver } from '../work-organization/conversation-agent-identity.js';
import type { WhisperRepository } from '../ports/whisper-repository.js';
import type { WhisperMessage } from '../../domain/whisper/whisper-message.js';
import { WhisperCallerNotResolvedError } from './open-whisper.js';

export interface SendWhisperMessageRequest {
  readonly tenantId: string;
  readonly callerConversationId: string;
  readonly whisperChannelId: string;
  readonly body: string;
}

/** A follow-up message from an existing whisper member. */
export class SendWhisperMessage {
  constructor(
    private readonly repository: WhisperRepository,
    private readonly agentIdentities: ConversationAgentIdentityResolver,
  ) {}

  async execute(input: SendWhisperMessageRequest): Promise<WhisperMessage> {
    const authorAgentDefinitionId = await this.agentIdentities.resolve({
      tenantId: input.tenantId,
      conversationId: input.callerConversationId,
    });
    if (!authorAgentDefinitionId) throw new WhisperCallerNotResolvedError();

    return this.repository.sendWhisperMessage({
      tenantId: input.tenantId,
      whisperChannelId: input.whisperChannelId,
      authorAgentDefinitionId,
      body: input.body,
    });
  }
}
