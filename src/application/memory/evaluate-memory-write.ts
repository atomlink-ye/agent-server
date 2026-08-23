import type { ServiceAccountAccessContext } from '../../domain/access-context.js';
import type { CreateMemoryProposal } from './create-memory-proposal.js';
import {
  evaluateMemoryPolicy,
  type MemoryPolicyDecision,
  type MemoryPolicyMode,
  type MemorySourceKind,
} from '../../domain/memory-policy/memory-policy.js';

export interface EvaluateMemoryWriteInput {
  readonly content: string;
  readonly category: string;
  readonly source: MemorySourceKind;
  readonly mode?: MemoryPolicyMode;
  readonly accessContext: ServiceAccountAccessContext;
  readonly sourceTaskId?: string | null;
}

export interface EvaluateMemoryWriteResult {
  readonly decision: MemoryPolicyDecision;
  readonly proposalCreated: boolean;
}

export class EvaluateMemoryWrite {
  public constructor(private readonly createProposal: CreateMemoryProposal) {}

  public async execute(
    input: EvaluateMemoryWriteInput,
  ): Promise<EvaluateMemoryWriteResult> {
    const decision = evaluateMemoryPolicy(input);
    if (decision.decision === 'proposal') {
      await this.createProposal.execute({
        content: input.content,
        category: input.category,
        ...(input.sourceTaskId !== undefined
          ? { sourceTaskId: input.sourceTaskId }
          : {}),
        accessContext: input.accessContext,
      });
      return { decision, proposalCreated: true };
    }
    return { decision, proposalCreated: false };
  }
}
