import { describe, expect, it } from 'vitest';

import {
  OpenWhisper,
  WhisperCallerNotResolvedError,
  WhisperInvalidPartnersError,
} from './open-whisper.js';
import { FakeWhisperRepository } from './whisper-repository.test-helper.js';

describe('OpenWhisper', () => {
  it('resolves the caller from the conversation and opens a whisper as that agent', async () => {
    const repository = new FakeWhisperRepository();
    const useCase = new OpenWhisper(repository, {
      async resolve() {
        return 'agent-a';
      },
    });

    const result = await useCase.execute({
      tenantId: 'tenant-1',
      callerConversationId: 'conv-1',
      partnerAgentDefinitionIds: ['agent-b'],
      topic: 'align on W-1',
      openingMessage: 'Need to sync privately.',
      triggerMessageId: 'msg-1',
      workRef: 'W-1',
    });

    expect(result.channel.initiatedByAgentDefinitionId).toBe('agent-a');
    expect(repository.openCalls).toEqual([
      {
        tenantId: 'tenant-1',
        initiatorAgentDefinitionId: 'agent-a',
        partnerAgentDefinitionIds: ['agent-b'],
        topic: 'align on W-1',
        openingMessage: 'Need to sync privately.',
        origin: {
          conversationId: 'conv-1',
          triggerMessageId: 'msg-1',
          workRef: 'W-1',
        },
      },
    ]);
  });

  it('refuses when the caller identity cannot be resolved', async () => {
    const repository = new FakeWhisperRepository();
    const useCase = new OpenWhisper(repository, {
      async resolve() {
        return null;
      },
    });

    await expect(
      useCase.execute({
        tenantId: 'tenant-1',
        callerConversationId: 'conv-1',
        partnerAgentDefinitionIds: ['agent-b'],
        openingMessage: 'hi',
      }),
    ).rejects.toBeInstanceOf(WhisperCallerNotResolvedError);
    expect(repository.openCalls).toHaveLength(0);
  });

  it('refuses when every partner id is the caller itself', async () => {
    const repository = new FakeWhisperRepository();
    const useCase = new OpenWhisper(repository, {
      async resolve() {
        return 'agent-a';
      },
    });

    await expect(
      useCase.execute({
        tenantId: 'tenant-1',
        callerConversationId: 'conv-1',
        partnerAgentDefinitionIds: ['agent-a'],
        openingMessage: 'hi',
      }),
    ).rejects.toBeInstanceOf(WhisperInvalidPartnersError);
  });

  it('deduplicates partner ids', async () => {
    const repository = new FakeWhisperRepository();
    const useCase = new OpenWhisper(repository, {
      async resolve() {
        return 'agent-a';
      },
    });

    await useCase.execute({
      tenantId: 'tenant-1',
      callerConversationId: 'conv-1',
      partnerAgentDefinitionIds: ['agent-b', 'agent-b', 'agent-a'],
      openingMessage: 'hi',
    });

    expect(repository.openCalls[0]?.partnerAgentDefinitionIds).toEqual([
      'agent-b',
    ]);
  });
});
