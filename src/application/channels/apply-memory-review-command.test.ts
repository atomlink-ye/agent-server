import { describe, expect, it, vi } from 'vitest';
import { ApplyMemoryReviewCommand } from './apply-memory-review-command.js';
import type { LarkCanaryEnabledConfig } from '../../shared/config.js';
import type { ChannelIngress } from '../../domain/channels/channel-event.js';

const config: LarkCanaryEnabledConfig = {
  enabled: true,
  connectionKey: 'conn',
  appId: 'app',
  domain: 'feishu',
  appSecret: 'secret',
  botOpenId: 'bot',
  allowedChatId: 'chat',
  allowedOpenId: 'user',
  tenantId: 'tenant',
  workspaceId: 'workspace',
  serviceAccountId: 'sa',
  publishedAgentVersionId: 'agent',
  policyVersion: 'policy',
};
const proposal = {
  id: 'proposal',
  tenantId: 'tenant',
  workspaceId: 'other-workspace',
  principalType: 'service_account',
  principalId: 'sa',
  sourceSessionId: 'session',
  status: 'pending',
} as any;
const ownedProposal = { ...proposal, workspaceId: 'workspace' };
const ingress = {
  id: 'ingress',
  connectionKey: 'conn',
  kind: 'command',
  externalKey: 'message',
  externalMessageId: 'message',
  chatId: 'chat',
  rootMessageId: 'root',
  externalActorId: 'user',
  action: { name: 'memory_review', decision: 'accept', proposalId: 'proposal' },
  normalizationVersion: 'test',
  status: 'processing',
  attemptCount: 1,
  leaseOwner: 'worker-1',
  createdAt: '',
  updatedAt: '',
} as ChannelIngress;

describe('ApplyMemoryReviewCommand', () => {
  it('fails closed for a proposal in another workspace before canonical review', async () => {
    const review = {
      findForAccess: vi.fn().mockResolvedValue(proposal),
      execute: vi.fn(),
    };
    const channels = {
      findBinding: vi
        .fn()
        .mockResolvedValue({ id: 'binding', sessionId: 'session' }),
      saveOutbox: vi.fn(),
      completeIngress: vi.fn().mockResolvedValue(undefined),
    };
    const apply = new ApplyMemoryReviewCommand(
      channels as any,
      review as any,
      { acceptEntry: vi.fn() } as any,
      config,
    );
    await apply.execute(ingress);
    expect(review.execute).not.toHaveBeenCalled();
    expect(channels.saveOutbox).not.toHaveBeenCalled();
  });

  it('writes bounded human-readable final feedback', async () => {
    const review = {
      findForAccess: vi.fn().mockResolvedValue(ownedProposal),
      execute: vi.fn().mockResolvedValue({
        proposal: {
          ...ownedProposal,
          status: 'accepted',
        },
        entry: {
          id: 'entry',
          proposalId: 'proposal',
          content: 'secret content',
        },
      }),
    };
    const channels = {
      findBinding: vi
        .fn()
        .mockResolvedValue({ id: 'binding', sessionId: 'session' }),
      saveOutbox: vi.fn().mockResolvedValue({ inserted: true }),
      completeIngress: vi.fn().mockResolvedValue(undefined),
      releaseIngress: vi.fn().mockResolvedValue(undefined),
    };
    const managed = {
      acceptEntry: vi.fn().mockResolvedValue({
        projectionStatus: 'ready',
        snapshotId: 'snapshot',
        contentHash: 'abcdef1234567890',
      }),
    };
    const apply = new ApplyMemoryReviewCommand(
      channels as any,
      review as any,
      managed as any,
      config,
    );
    await apply.execute(ingress);
    const payload = channels.saveOutbox.mock.calls[0]![0]!.payload as string;
    expect(payload).toContain('Memory review accepted');
    expect(payload).not.toContain('secret content');
    expect(() => JSON.parse(payload)).toThrow();
  });

  it('rejects without publishing an entry', async () => {
    const review = {
      findForAccess: vi.fn().mockResolvedValue(ownedProposal),
      execute: vi.fn().mockResolvedValue({
        proposal: { ...ownedProposal, status: 'rejected' },
        entry: null,
      }),
    };
    const channels = {
      findBinding: vi
        .fn()
        .mockResolvedValue({ id: 'binding', sessionId: 'session' }),
      saveOutbox: vi.fn().mockResolvedValue({ inserted: true }),
      completeIngress: vi.fn().mockResolvedValue(undefined),
      releaseIngress: vi.fn().mockResolvedValue(undefined),
    };
    const managed = { acceptEntry: vi.fn() };
    const apply = new ApplyMemoryReviewCommand(
      channels as any,
      review as any,
      managed as any,
      config,
    );
    await apply.execute({
      ...ingress,
      action: {
        name: 'memory_review',
        decision: 'reject',
        proposalId: 'proposal',
      },
    });
    expect(managed.acceptEntry).not.toHaveBeenCalled();
    expect(channels.saveOutbox.mock.calls[0]![0]!.payload).toContain(
      'Memory review rejected',
    );
  });

  it('fails projection without feedback and retries publication on replay', async () => {
    const entry = { id: 'entry', proposalId: 'proposal', content: 'safe' };
    const review = {
      findForAccess: vi.fn().mockResolvedValue(ownedProposal),
      execute: vi.fn().mockResolvedValue({
        proposal: { ...ownedProposal, status: 'accepted' },
        entry,
      }),
    };
    const channels = {
      findBinding: vi
        .fn()
        .mockResolvedValue({ id: 'binding', sessionId: 'session' }),
      saveOutbox: vi.fn().mockResolvedValue({ inserted: true }),
      completeIngress: vi.fn().mockResolvedValue(undefined),
      releaseIngress: vi.fn().mockResolvedValue(undefined),
    };
    const managed = {
      acceptEntry: vi
        .fn()
        .mockRejectedValueOnce(new Error('store path'))
        .mockResolvedValueOnce({
          projectionStatus: 'ready',
          snapshotId: 'snapshot',
          contentHash: 'abcdef123456',
        }),
    };
    const apply = new ApplyMemoryReviewCommand(
      channels as any,
      review as any,
      managed as any,
      config,
    );
    expect((await apply.execute(ingress)).accepted).toBe(false);
    expect(channels.saveOutbox).not.toHaveBeenCalled();
    expect((await apply.execute(ingress)).accepted).toBe(true);
    expect(managed.acceptEntry).toHaveBeenCalledTimes(2);
    expect(channels.saveOutbox).toHaveBeenCalledOnce();
  });
});
