import type {
  OpenWhisperInput,
  WhisperRepository,
} from '../ports/whisper-repository.js';
import type { WhisperChannel } from '../../domain/whisper/whisper-channel.js';
import type { WhisperMessage } from '../../domain/whisper/whisper-message.js';

let nextId = 1;

/** In-memory double covering exactly the port surface, for application tests. */
export class FakeWhisperRepository implements WhisperRepository {
  public readonly openCalls: OpenWhisperInput[] = [];
  public readonly channels = new Map<string, WhisperChannel>();
  public readonly messages = new Map<string, WhisperMessage[]>();

  async openWhisper(input: OpenWhisperInput): Promise<{
    readonly channel: WhisperChannel;
    readonly message: WhisperMessage;
  }> {
    this.openCalls.push(input);
    const id = `channel-${nextId++}`;
    const now = new Date().toISOString();
    const channel: WhisperChannel = Object.freeze({
      id,
      tenantId: input.tenantId,
      topic: input.topic ?? null,
      memberAgentDefinitionIds: Object.freeze([
        input.initiatorAgentDefinitionId,
        ...input.partnerAgentDefinitionIds,
      ]),
      initiatedByAgentDefinitionId: input.initiatorAgentDefinitionId,
      origin: Object.freeze({
        conversationId: input.origin?.conversationId ?? null,
        triggerMessageId: input.origin?.triggerMessageId ?? null,
        workRef: input.origin?.workRef ?? null,
      }),
      nextSequence: 2,
      createdAt: now,
      updatedAt: now,
    });
    const message: WhisperMessage = Object.freeze({
      id: `message-${nextId++}`,
      tenantId: input.tenantId,
      whisperChannelId: id,
      sequence: 1,
      authorAgentDefinitionId: input.initiatorAgentDefinitionId,
      body: input.openingMessage,
      createdAt: now,
    });
    this.channels.set(id, channel);
    this.messages.set(id, [message]);
    return { channel, message };
  }

  async sendWhisperMessage(input: {
    readonly tenantId: string;
    readonly whisperChannelId: string;
    readonly authorAgentDefinitionId: string;
    readonly body: string;
  }): Promise<WhisperMessage> {
    const channel = this.channels.get(input.whisperChannelId);
    if (!channel) throw new Error('Whisper channel not found.');
    if (
      !channel.memberAgentDefinitionIds.includes(input.authorAgentDefinitionId)
    )
      throw new Error('Message author is not a whisper channel member.');
    const existing = this.messages.get(input.whisperChannelId) ?? [];
    const message: WhisperMessage = Object.freeze({
      id: `message-${nextId++}`,
      tenantId: input.tenantId,
      whisperChannelId: input.whisperChannelId,
      sequence: existing.length + 1,
      authorAgentDefinitionId: input.authorAgentDefinitionId,
      body: input.body,
      createdAt: new Date().toISOString(),
    });
    this.messages.set(input.whisperChannelId, [...existing, message]);
    return message;
  }

  async listAllWhisperChannels(input: {
    readonly tenantId: string;
  }): Promise<readonly WhisperChannel[]> {
    return [...this.channels.values()].filter(
      (channel) => channel.tenantId === input.tenantId,
    );
  }

  async getWhisperChannel(input: {
    readonly tenantId: string;
    readonly whisperChannelId: string;
  }): Promise<WhisperChannel | null> {
    const channel = this.channels.get(input.whisperChannelId);
    return channel && channel.tenantId === input.tenantId ? channel : null;
  }

  async listWhisperMessages(input: {
    readonly tenantId: string;
    readonly whisperChannelId: string;
  }): Promise<readonly WhisperMessage[]> {
    const channel = await this.getWhisperChannel(input);
    if (!channel) return [];
    return this.messages.get(input.whisperChannelId) ?? [];
  }
}
