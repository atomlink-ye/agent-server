import type { MemoryReviewApi } from '../ports/memory-review-api.js';
import type { LarkMemoryReviewSurface } from '../../domain/channels/lark-memory-review-surface.js';
import type { MemoryProposal } from '../../domain/workspace-memory/memory-proposal.js';
import type { ServiceAccountAccessContext } from '../../domain/access-context.js';
import {
  evaluateMemoryPolicy,
  MEMORY_POLICY_CATEGORIES,
} from '../../domain/memory-policy/memory-policy.js';

const PROFILE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const DOC_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

export class AcceptMemoryFromBoundDocument {
  public constructor(
    private readonly review: Pick<MemoryReviewApi['review'], 'execute'>,
    private readonly managedMemory: Pick<
      MemoryReviewApi['managedMemory'],
      'acceptEntry'
    >,
    private readonly profile = 'agent-test',
  ) {
    if (!PROFILE.test(profile)) throw new Error('invalid Lark CLI profile');
  }

  public async execute(input: {
    readonly ingressId: string;
    readonly proposal: Pick<
      MemoryProposal,
      'id' | 'originalCategory' | 'sourceSessionId' | 'sourceRunId'
    > & {
      readonly reviewedContent?: string | null;
      readonly status: string;
      readonly reviewControllerIngressId?: string | null;
    };
    readonly surface: Pick<LarkMemoryReviewSurface, 'mode' | 'docToken'>;
    readonly owner: ServiceAccountAccessContext;
  }) {
    if (input.surface.mode !== 'card_with_doc' || !input.surface.docToken)
      throw new Error('bound_document_not_ready');
    if (!DOC_TOKEN.test(input.surface.docToken))
      throw new Error('invalid_doc_token');
    if (
      !MEMORY_POLICY_CATEGORIES.includes(
        input.proposal
          .originalCategory as (typeof MEMORY_POLICY_CATEGORIES)[number],
      )
    )
      throw new Error('invalid_memory_category');
    const replay = input.proposal.status === 'accepted';
    if (
      replay &&
      (input.proposal.reviewControllerIngressId !== input.ingressId ||
        !input.proposal.reviewedContent)
    )
      throw new Error('review_replay_unavailable');
    if (!replay && input.proposal.status !== 'pending')
      throw new Error('bound_document_not_ready');
    const execution = replay
      ? null
      : await (async () => {
          if (!input.proposal.sourceSessionId || !input.proposal.sourceRunId)
            throw new Error('source_binding_missing');
          throw new Error('durable_runtime_source_required');
        })();
    const candidate = replay
      ? {
          category: input.proposal.originalCategory,
          content: input.proposal.reviewedContent!,
        }
      : null;
    const content = candidate?.content.trim();
    if (
      !candidate ||
      candidate.category !== input.proposal.originalCategory ||
      !content ||
      Buffer.byteLength(content, 'utf8') > 4096
    )
      throw new Error('invalid_memory_artifact');
    const policy = evaluateMemoryPolicy({
      mode: 'auto_safe',
      source: 'structured_system',
      category: candidate.category,
      content,
    });
    if (policy.decision !== 'accept')
      throw new Error('invalid_memory_artifact');
    const reviewed = await this.review.execute({
      proposalId: input.proposal.id,
      action: 'edit_and_accept',
      content,
      accessContext: input.owner,
      controller: { kind: 'channel_ingress', ingressId: input.ingressId },
    });
    if (!reviewed.entry) throw new Error('memory_entry_missing');
    const snapshot = await this.managedMemory.acceptEntry(reviewed.entry);
    if (snapshot.projectionStatus !== 'ready')
      throw new Error('memory_projection_not_ready');
    return { content, snapshot };
  }
}
