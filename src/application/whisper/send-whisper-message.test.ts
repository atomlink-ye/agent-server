import { describe, expect, it } from 'vitest';

import { SendWhisperMessage } from './send-whisper-message.js';
import { OpenWhisper, WhisperCallerNotResolvedError } from './open-whisper.js';
import { FakeWhisperRepository } from './whisper-repository.test-helper.js';

describe('SendWhisperMessage', () => {
  it('resolves the caller from its conversation and posts as that member', async () => {
    const repository = new FakeWhisperRepository();
    const opened = await new OpenWhisper(repository, {
      async resolve() {
        return 'agent-a';
      },
    }).execute({
      tenantId: 'tenant-1',
      callerConversationId: 'conv-1',
      partnerAgentDefinitionIds: ['agent-b'],
      openingMessage: 'Opening.',
    });

    const useCase = new SendWhisperMessage(repository, {
      async resolve() {
        return 'agent-b';
      },
    });
    const message = await useCase.execute({
      tenantId: 'tenant-1',
      callerConversationId: 'conv-2',
      whisperChannelId: opened.channel.id,
      body: 'Got it.',
    });

    expect(message.authorAgentDefinitionId).toBe('agent-b');
    expect(message.sequence).toBe(2);
  });

  it('refuses when the caller identity cannot be resolved', async () => {
    const repository = new FakeWhisperRepository();
    const useCase = new SendWhisperMessage(repository, {
      async resolve() {
        return null;
      },
    });

    await expect(
      useCase.execute({
        tenantId: 'tenant-1',
        callerConversationId: 'conv-1',
        whisperChannelId: 'channel-x',
        body: 'hi',
      }),
    ).rejects.toBeInstanceOf(WhisperCallerNotResolvedError);
  });
});
