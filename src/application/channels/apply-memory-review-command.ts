import { createHash, randomUUID } from 'node:crypto';
import type { ChannelIngress } from '../../domain/channels/channel-event.js';
import type { ChannelRepository } from '../ports/channel-repository.js';
import type { LarkCanaryEnabledConfig } from '../../shared/config.js';
import type { MemoryReviewApi } from '../ports/memory-review-api.js';
import { ownerFromLarkCanary } from './resolve-lark-binding.js';
import type { WorkspaceMemoryEntry } from '../../domain/workspace-memory/memory-proposal.js';

export class ApplyMemoryReviewCommand {
  public constructor(
    private readonly channels: Pick<
      ChannelRepository,
      'findBinding' | 'saveOutbox' | 'completeIngress' | 'releaseIngress'
    >,
    private readonly review: MemoryReviewApi['review'],
    private readonly managedMemory: Pick<
      MemoryReviewApi['managedMemory'],
      'acceptEntry'
    >,
    private readonly config: LarkCanaryEnabledConfig,
    private readonly idFactory: () => string = randomUUID,
  ) {}

  public async execute(
    ingress: ChannelIngress,
  ): Promise<{ readonly accepted: boolean; readonly reason?: string }> {
    const fail = async (
      reason: string,
      status: 'processed' | 'failed' = 'processed',
    ) => {
      await this.channels.completeIngress({
        ingressId: ingress.id,
        status,
        safeErrorCode: reason,
        ...ingressFence(ingress),
      });
      return { accepted: false, reason };
    };
    if (ingress.kind !== 'command') return fail('unsupported_ingress');
    if (
      ingress.connectionKey !== this.config.connectionKey ||
      ingress.chatId !== this.config.allowedChatId ||
      ingress.externalActorId !== this.config.allowedOpenId
    )
      return fail('command_not_allowed');
    const rootMessageId = ingress.rootMessageId;
    const action = ingress.action;
    if (!rootMessageId || !action || action.name !== 'memory_review')
      return fail('invalid_memory_command');
    if (action.decision === 'invalid') return fail('invalid_memory_command');
    const proposalId = action.proposalId;
    if (typeof proposalId !== 'string') return fail('invalid_memory_command');
    const binding = await this.channels.findBinding({
      connectionKey: ingress.connectionKey,
      chatId: ingress.chatId,
      rootMessageId,
    });
    if (!binding?.sessionId) return fail('binding_not_found');
    const owner = ownerFromLarkCanary(this.config);
    const proposal = await this.review.findForAccess(proposalId, owner);
    if (
      !proposal ||
      proposal.tenantId !== owner.tenantId ||
      proposal.workspaceId !== owner.workspaceId ||
      proposal.principalType !== owner.principalType ||
      proposal.principalId !== owner.principalId ||
      proposal.sourceSessionId !== binding.sessionId
    )
      return fail('proposal_not_allowed');
    const decision = action.decision as 'accept' | 'edit_and_accept' | 'reject';
    let durableDecision = false;
    try {
      const reviewed = await this.review.execute({
        proposalId,
        action: decision,
        ...(decision === 'edit_and_accept' && typeof action.content === 'string'
          ? { content: action.content }
          : {}),
        accessContext: owner,
        controller: { kind: 'channel_ingress', ingressId: ingress.id },
      });
      durableDecision = true;
      let snapshotId: string | undefined;
      let hashPrefix: string | undefined;
      if (reviewed.entry) {
        const snapshot = await this.managedMemory.acceptEntry(
          reviewed.entry as WorkspaceMemoryEntry,
        );
        if (snapshot.projectionStatus !== 'ready') {
          await this.channels.releaseIngress({
            ingressId: ingress.id,
            leaseOwner: ingress.leaseOwner!,
            attemptNumber: ingress.attemptCount,
            safeErrorCode: 'memory_projection_not_ready',
          });
          return { accepted: false, reason: 'memory_projection_not_ready' };
        }
        snapshotId = snapshot.snapshotId;
        hashPrefix = snapshot.contentHash.slice(0, 12);
      }
      if (!ingress.externalMessageId) {
        await this.channels.releaseIngress({
          ingressId: ingress.id,
          leaseOwner: ingress.leaseOwner!,
          attemptNumber: ingress.attemptCount,
          safeErrorCode: 'memory_review_retryable',
        });
        return { accepted: false, reason: 'memory_review_retryable' };
      }
      const payload = reviewed.entry
        ? [
            'Memory review accepted and published.',
            `Proposal: ${proposalId}`,
            `Entry: ${reviewed.entry.id}`,
            `Snapshot: ${snapshotId}`,
            `Content hash: ${hashPrefix}`,
          ].join('\n')
        : ['Memory review rejected.', `Proposal: ${proposalId}`].join('\n');
      await this.channels.saveOutbox({
        id: this.idFactory(),
        connectionKey: ingress.connectionKey,
        bindingId: binding.id,
        targetId: ingress.externalMessageId,
        deliveryKind: 'memory-review-result',
        aggregateId: proposalId,
        aggregateVersion: 1,
        payload,
        providerRequestId: `memory-result-${createHash('sha256').update(ingress.externalMessageId).digest('hex').slice(0, 30)}`,
      });
      await this.channels.completeIngress({
        ingressId: ingress.id,
        status: 'processed',
        ...ingressFence(ingress),
      });
      return { accepted: true };
    } catch (error) {
      const reason =
        error instanceof Error &&
        'code' in error &&
        typeof error.code === 'string'
          ? error.code
          : 'memory_review_failed';
      if (durableDecision) {
        await this.channels.releaseIngress({
          ingressId: ingress.id,
          leaseOwner: ingress.leaseOwner!,
          attemptNumber: ingress.attemptCount,
          safeErrorCode: 'memory_review_retryable',
        });
        return { accepted: false, reason: 'memory_review_retryable' };
      }
      return fail(reason, 'failed');
    }
  }
}

function ingressFence(ingress: ChannelIngress): {
  readonly leaseOwner: string;
  readonly attemptNumber: number;
} {
  if (!ingress.leaseOwner) throw new Error('claimed ingress lease is required');
  return {
    leaseOwner: ingress.leaseOwner,
    attemptNumber: ingress.attemptCount,
  };
}
