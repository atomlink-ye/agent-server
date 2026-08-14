import { createHash, randomUUID } from 'node:crypto';

import type { ChannelRepository } from '../ports/channel-repository.js';
import type { MemoryReviewApi } from '../ports/memory-review-api.js';
import type { Run } from '../../domain/runs/run.js';
import type { Task } from '../../domain/tasks/task.js';
import { selectMemoryReviewSurface } from './select-memory-review-surface.js';
import type { LarkReviewSurfaceRepository } from '../ports/lark-review-surface-repository.js';
import type { MemoryReviewActionTokenDeriver } from './memory-review-action-token.js';
import type { MemoryDocumentPort } from '../ports/lark-memory-document.js';

const DELIVERY_KIND = 'memory_review_command';
const AGENT_RESULT_DELIVERY_KIND = 'agent_run_result';
const MAX_PAYLOAD_BYTES = 8192;

export class PublishMemoryReviewSurface {
  public constructor(
    private readonly memory: MemoryReviewApi['workspaceMemory'],
    private readonly channels: {
      findBindingBySessionId: NonNullable<
        ChannelRepository['findBindingBySessionId']
      >;
    },
    private readonly outbox: Pick<ChannelRepository, 'saveOutbox'>,
    private readonly connectionKey = 'lark-canary',
    private readonly surfaces?: Pick<
      LarkReviewSurfaceRepository,
      'createCardSurfaceAndOutbox' | 'getActiveSurface'
    >,
    private readonly tokenDeriver?: MemoryReviewActionTokenDeriver,
    private readonly documents?: MemoryDocumentPort,
    private readonly allowedOpenId?: string,
  ) {}

  public async execute(input: {
    readonly run: Run;
    readonly task: Task;
  }): Promise<void> {
    if (
      input.run.status !== 'succeeded' ||
      input.task.ingress !== 'lark' ||
      !input.task.sessionId
    )
      return;

    const ownerScope = {
      tenantId: input.task.tenantId,
      workspaceId: input.task.workspaceId,
      principalType: input.task.principalType,
      principalId: input.task.principalId,
    };
    const proposals = await this.memory.listPendingProposalsBySourceRunForOwner(
      input.run.id,
      ownerScope,
    );
    const binding = await this.channels.findBindingBySessionId({
      connectionKey: this.connectionKey,
      sessionId: input.task.sessionId,
    });
    if (!binding || binding.status !== 'active') return;

    if (input.run.result) {
      await this.outbox.saveOutbox({
        id: randomUUID(),
        connectionKey: binding.connectionKey,
        bindingId: binding.id,
        targetId: binding.rootMessageId,
        deliveryKind: AGENT_RESULT_DELIVERY_KIND,
        aggregateId: input.run.id,
        aggregateVersion: 1,
        payload: renderAgentResult(input.run.result.text),
        providerRequestId: agentResultProviderRequestId(input.run.id),
      });
    }

    for (const proposal of proposals) {
      const selected = selectMemoryReviewSurface({
        content: proposal.originalContent,
      });
      const selection =
        selected.mode === 'command_only'
          ? selected
          : { ...selected, mode: 'card_with_doc' as const };
      if (
        this.surfaces &&
        (await this.surfaces.getActiveSurface({
          tenantId: proposal.tenantId,
          workspaceId: proposal.workspaceId,
          principalType: proposal.principalType,
          principalId: proposal.principalId,
          proposalId: proposal.id,
          bindingId: binding.id,
        }))
      )
        continue;
      if (
        this.surfaces &&
        this.tokenDeriver &&
        (selection.mode === 'card' || selection.mode === 'card_with_doc')
      ) {
        let doc: Awaited<ReturnType<MemoryDocumentPort['create']>> | undefined;
        if (
          selection.mode === 'card_with_doc' &&
          this.documents &&
          this.allowedOpenId
        ) {
          try {
            doc = await this.documents.create({
              category: proposal.originalCategory,
              proposal: proposal.originalContent,
              allowedOpenId: this.allowedOpenId,
            });
          } catch {
            doc = undefined;
          }
        }
        if (selection.mode === 'card_with_doc' && !doc) {
          await this.outbox.saveOutbox({
            id: randomUUID(),
            connectionKey: binding.connectionKey,
            bindingId: binding.id,
            targetId: binding.rootMessageId,
            deliveryKind: DELIVERY_KIND,
            aggregateId: proposal.id,
            aggregateVersion: 1,
            payload: renderPayload(proposal.id, input.run.id),
            providerRequestId: providerId(proposal.id),
          });
          continue;
        }
        const surfaceId = randomUUID();
        const token = this.tokenDeriver.derive({ surfaceId, version: 1 });
        const surface = {
          id: surfaceId,
          tenantId: proposal.tenantId,
          workspaceId: proposal.workspaceId,
          principalType: proposal.principalType,
          principalId: proposal.principalId,
          proposalId: proposal.id,
          bindingId: binding.id,
          version: 1,
          mode: doc ? 'card_with_doc' : 'card',
          status: 'planned',
          cardMessageId: null,
          docToken: doc?.token ?? null,
          docRevision: doc?.revision ?? null,
          previewContent: null,
          previewSha256: null,
          actionTokenHash: createHash('sha256').update(token).digest('hex'),
          creatingIngressId: binding.creatingIngressId,
          resolvingIngressId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as const;
        const descriptor = {
          type: doc
            ? ('lark_memory_doc_card_v1' as const)
            : ('lark_memory_review_card_v1' as const),
          surfaceId,
          version: 1,
          proposalId: proposal.id,
          bindingId: binding.id,
          owner: ownerScope,
          category: proposal.originalCategory,
          ...(doc
            ? {
                content: proposal.originalContent,
                excerpt: utf8Prefix(proposal.originalContent, 1000),
                docToken: doc.token,
                docRevision: doc.revision,
              }
            : { content: proposal.originalContent }),
          source:
            'Proposed by the completed agent task in this thread.' as const,
        };
        await this.surfaces.createCardSurfaceAndOutbox({
          surface,
          deriveActionTokenHash: (id, version) =>
            createHash('sha256')
              .update(this.tokenDeriver!.derive({ surfaceId: id, version }))
              .digest('hex'),
          outbox: {
            id: randomUUID(),
            connectionKey: binding.connectionKey,
            bindingId: binding.id,
            targetId: binding.rootMessageId,
            deliveryKind: 'lark_card_reply',
            aggregateId: proposal.id,
            aggregateVersion: 1,
            payload: JSON.stringify(descriptor),
            providerRequestId: cardProviderRequestId(proposal.id),
          },
        });
        continue;
      }
      await this.outbox.saveOutbox({
        id: randomUUID(),
        connectionKey: binding.connectionKey,
        bindingId: binding.id,
        targetId: binding.rootMessageId,
        deliveryKind: DELIVERY_KIND,
        aggregateId: proposal.id,
        aggregateVersion: 1,
        payload: renderPayload(proposal.id, input.run.id),
        providerRequestId: providerRequestId(proposal.id),
      });
    }
  }
}

function cardProviderRequestId(proposalId: string): string {
  const digest = createHash('sha256')
    .update(`lark_card_reply|${proposalId}|1`)
    .digest('hex')
    .slice(0, 32);
  return `mrc-card-v1-${digest}`;
}

function providerRequestId(proposalId: string): string {
  const digest = createHash('sha256')
    .update(`${DELIVERY_KIND}|${proposalId}|1`)
    .digest('hex')
    .slice(0, 32);
  return `mrc-v1-${digest}`;
}
function providerId(proposalId: string): string {
  return `mrc-fallback-${createHash('sha256').update(proposalId).digest('hex').slice(0, 32)}`;
}

function agentResultProviderRequestId(runId: string): string {
  const digest = createHash('sha256')
    .update(`${AGENT_RESULT_DELIVERY_KIND}|${runId}|1`)
    .digest('hex')
    .slice(0, 32);
  return `arr-v1-${digest}`;
}

function renderAgentResult(text: string): string {
  return truncateUtf8(`Agent final answer:\n${text}`, MAX_PAYLOAD_BYTES);
}

function truncateUtf8(text: string, maxBytes: number): string {
  return utf8Prefix(text, maxBytes);
}

function utf8Prefix(text: string, maxBytes: number): string {
  let bytes = 0;
  let result = '';
  for (const codePoint of text) {
    const codePointBytes = Buffer.byteLength(codePoint, 'utf8');
    if (bytes + codePointBytes > maxBytes) break;
    result += codePoint;
    bytes += codePointBytes;
  }
  return result;
}

function renderPayload(proposalId: string, runId: string): string {
  return [
    'Workspace memory proposal ready for review.',
    `Proposal: ${proposalId}`,
    `Source run: ${runId}`,
    '',
    'Commands:',
    `/memory accept ${proposalId}`,
    `/memory edit-and-accept ${proposalId} <revised text>`,
    `/memory reject ${proposalId}`,
  ].join('\n');
}
