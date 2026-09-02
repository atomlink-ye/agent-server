import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

import { applyDurableKernelMigrations } from './postgres.js';
import { PostgresWhisperRepository } from './postgres-whisper-repository.js';

const TENANT = 'tenant-whisper';
const PUBLIC_CONVERSATION_ID = '00000000-0000-4000-8000-000000000101';

async function withDb() {
  const db = new PGlite();
  await applyDurableKernelMigrations(db);
  return db;
}

async function seedPublicConversation(db: PGlite): Promise<void> {
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO conversations (id, tenant_id, kind, next_sequence, created_at, updated_at)
     VALUES ($1, $2, 'direct', 1, $3, $3)`,
    [PUBLIC_CONVERSATION_ID, TENANT, now],
  );
}

describe('PostgresWhisperRepository', () => {
  it('opens a two-agent whisper, posts the opening message, and reuses the channel on a second open', async () => {
    const db = await withDb();
    await seedPublicConversation(db);
    const repository = new PostgresWhisperRepository(db);

    const first = await repository.openWhisper({
      tenantId: TENANT,
      initiatorAgentDefinitionId: 'agent-a',
      partnerAgentDefinitionIds: ['agent-b'],
      topic: 'coordinate on W-42',
      openingMessage: 'Hey, quick side-channel about W-42.',
      origin: {
        conversationId: PUBLIC_CONVERSATION_ID,
        triggerMessageId: null,
        workRef: 'W-42',
      },
    });

    expect(first.channel.memberAgentDefinitionIds).toEqual([
      'agent-a',
      'agent-b',
    ]);
    expect(first.channel.initiatedByAgentDefinitionId).toBe('agent-a');
    expect(first.channel.origin).toEqual({
      conversationId: PUBLIC_CONVERSATION_ID,
      triggerMessageId: null,
      workRef: 'W-42',
    });
    expect(first.message.sequence).toBe(1);
    expect(first.message.authorAgentDefinitionId).toBe('agent-a');

    const second = await repository.openWhisper({
      tenantId: TENANT,
      initiatorAgentDefinitionId: 'agent-b',
      partnerAgentDefinitionIds: ['agent-a'],
      openingMessage: 'Following up.',
    });

    expect(second.channel.id).toBe(first.channel.id);
    expect(second.message.sequence).toBe(2);
    // Origin captured on first open is preserved, not overwritten.
    expect(second.channel.origin.workRef).toBe('W-42');

    const messages = await repository.listWhisperMessages({
      tenantId: TENANT,
      whisperChannelId: first.channel.id,
    });
    expect(messages.map((message) => message.body)).toEqual([
      'Hey, quick side-channel about W-42.',
      'Following up.',
    ]);
  });

  it('creates a distinct room for a 3+ agent whisper (no pair reuse)', async () => {
    const db = await withDb();
    const repository = new PostgresWhisperRepository(db);

    const first = await repository.openWhisper({
      tenantId: TENANT,
      initiatorAgentDefinitionId: 'agent-a',
      partnerAgentDefinitionIds: ['agent-b', 'agent-c'],
      openingMessage: 'Pulling both of you in.',
    });
    expect(first.channel.memberAgentDefinitionIds).toEqual([
      'agent-a',
      'agent-b',
      'agent-c',
    ]);

    const second = await repository.openWhisper({
      tenantId: TENANT,
      initiatorAgentDefinitionId: 'agent-a',
      partnerAgentDefinitionIds: ['agent-b', 'agent-c'],
      openingMessage: 'A second, separate room.',
    });
    expect(second.channel.id).not.toBe(first.channel.id);
  });

  it('lets a member send a follow-up message and rejects a non-member', async () => {
    const db = await withDb();
    const repository = new PostgresWhisperRepository(db);
    const opened = await repository.openWhisper({
      tenantId: TENANT,
      initiatorAgentDefinitionId: 'agent-a',
      partnerAgentDefinitionIds: ['agent-b'],
      openingMessage: 'Opening.',
    });

    const sent = await repository.sendWhisperMessage({
      tenantId: TENANT,
      whisperChannelId: opened.channel.id,
      authorAgentDefinitionId: 'agent-b',
      body: 'Got it, will do.',
    });
    expect(sent.sequence).toBe(2);

    await expect(
      repository.sendWhisperMessage({
        tenantId: TENANT,
        whisperChannelId: opened.channel.id,
        authorAgentDefinitionId: 'agent-outsider',
        body: 'Should not land.',
      }),
    ).rejects.toThrow();
  });

  it('exposes every whisper channel in the tenant for the human peek surface', async () => {
    const db = await withDb();
    const repository = new PostgresWhisperRepository(db);
    await repository.openWhisper({
      tenantId: TENANT,
      initiatorAgentDefinitionId: 'agent-a',
      partnerAgentDefinitionIds: ['agent-b'],
      openingMessage: 'One.',
    });
    await repository.openWhisper({
      tenantId: TENANT,
      initiatorAgentDefinitionId: 'agent-c',
      partnerAgentDefinitionIds: ['agent-d'],
      openingMessage: 'Two.',
    });

    const channels = await repository.listAllWhisperChannels({
      tenantId: TENANT,
    });
    expect(channels).toHaveLength(2);

    const missing = await repository.getWhisperChannel({
      tenantId: TENANT,
      whisperChannelId: '00000000-0000-4000-8000-000000000000',
    });
    expect(missing).toBeNull();
  });
});
