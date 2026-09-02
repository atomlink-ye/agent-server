import type { WhisperRepository } from '../ports/whisper-repository.js';
import type { WhisperChannel } from '../../domain/whisper/whisper-channel.js';
import type { WhisperMessage } from '../../domain/whisper/whisper-message.js';

/**
 * The human-facing, read-only "peek" surface. There is no write method
 * here on purpose: a human can list and read whisper channels, never post
 * into one. Callers (HTTP routes) never expose a POST for this data.
 */
export class PeekWhisperChannels {
  constructor(private readonly repository: WhisperRepository) {}

  listChannels(tenantId: string): Promise<readonly WhisperChannel[]> {
    return this.repository.listAllWhisperChannels({ tenantId });
  }

  async getChannelWithMessages(
    tenantId: string,
    whisperChannelId: string,
  ): Promise<{
    readonly channel: WhisperChannel;
    readonly messages: readonly WhisperMessage[];
  } | null> {
    const channel = await this.repository.getWhisperChannel({
      tenantId,
      whisperChannelId,
    });
    if (!channel) return null;
    const messages = await this.repository.listWhisperMessages({
      tenantId,
      whisperChannelId,
    });
    return { channel, messages };
  }
}
