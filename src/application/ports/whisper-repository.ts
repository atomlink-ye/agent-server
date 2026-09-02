import type { WhisperChannel } from '../../domain/whisper/whisper-channel.js';
import type { WhisperMessage } from '../../domain/whisper/whisper-message.js';

export interface OpenWhisperInput {
  readonly tenantId: string;
  readonly initiatorAgentDefinitionId: string;
  readonly partnerAgentDefinitionIds: readonly string[];
  readonly topic?: string | null;
  readonly openingMessage: string;
  readonly origin?: {
    readonly conversationId?: string | null;
    readonly triggerMessageId?: string | null;
    readonly workRef?: string | null;
  };
}

export interface WhisperRepository {
  /**
   * Opens a whisper channel and posts the opening message atomically. A
   * two-agent whisper reuses any existing channel for that pair (same
   * dedup semantics as `findOrCreateDirect`); three or more agents always
   * creates a new room.
   */
  openWhisper(input: OpenWhisperInput): Promise<{
    readonly channel: WhisperChannel;
    readonly message: WhisperMessage;
  }>;

  sendWhisperMessage(input: {
    readonly tenantId: string;
    readonly whisperChannelId: string;
    readonly authorAgentDefinitionId: string;
    readonly body: string;
  }): Promise<WhisperMessage>;

  /** Human peek surface: every whisper channel in the tenant. */
  listAllWhisperChannels(input: {
    readonly tenantId: string;
  }): Promise<readonly WhisperChannel[]>;

  getWhisperChannel(input: {
    readonly tenantId: string;
    readonly whisperChannelId: string;
  }): Promise<WhisperChannel | null>;

  listWhisperMessages(input: {
    readonly tenantId: string;
    readonly whisperChannelId: string;
  }): Promise<readonly WhisperMessage[]>;
}
