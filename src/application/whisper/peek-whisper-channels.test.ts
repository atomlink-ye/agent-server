import { describe, expect, it } from 'vitest';

import { PeekWhisperChannels } from './peek-whisper-channels.js';
import { OpenWhisper } from './open-whisper.js';
import { FakeWhisperRepository } from './whisper-repository.test-helper.js';

describe('PeekWhisperChannels', () => {
  it('lists every whisper channel in the tenant for the human peek surface', async () => {
    const repository = new FakeWhisperRepository();
    await new OpenWhisper(repository, {
      async resolve() {
        return 'agent-a';
      },
    }).execute({
      tenantId: 'tenant-1',
      callerConversationId: 'conv-1',
      partnerAgentDefinitionIds: ['agent-b'],
      openingMessage: 'hi',
    });

    const peek = new PeekWhisperChannels(repository);
    const channels = await peek.listChannels('tenant-1');
    expect(channels).toHaveLength(1);
    expect(channels[0]?.memberAgentDefinitionIds).toEqual([
      'agent-a',
      'agent-b',
    ]);
  });

  it('reads a channel with its messages, and returns null when it does not exist', async () => {
    const repository = new FakeWhisperRepository();
    const opened = await new OpenWhisper(repository, {
      async resolve() {
        return 'agent-a';
      },
    }).execute({
      tenantId: 'tenant-1',
      callerConversationId: 'conv-1',
      partnerAgentDefinitionIds: ['agent-b'],
      openingMessage: 'hi there',
    });

    const peek = new PeekWhisperChannels(repository);
    const found = await peek.getChannelWithMessages(
      'tenant-1',
      opened.channel.id,
    );
    expect(found?.messages.map((message) => message.body)).toEqual([
      'hi there',
    ]);

    const missing = await peek.getChannelWithMessages('tenant-1', 'nope');
    expect(missing).toBeNull();
  });
});
