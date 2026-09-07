import type { AccessContext } from '../../domain/access-context.js';
import type { WorkDefinitionSourceRepository } from '../ports/work-definition-source-repository.js';
import type { ProductWorkDefinitionApi } from '../work/product-work-definition-api.js';
import {
  compileCoworkerDefaultCapability,
  type CoworkerAuthoringDraft,
} from './coworker-authoring.js';

export interface CoworkerDefaultCapability {
  readonly definitionId: string;
  readonly definitionVersionId: string;
  readonly normalizedName: string;
}

/**
 * Hiring a Coworker also gives it one Work it knows how to run.
 *
 * `Work Definition -> Work -> WorkRun` is the product's own vocabulary, and a
 * Coworker with no `agent_work_bindings` row cannot enter it: it answers
 * `list_agent_workflows` with an empty list and has no Definition id to pass
 * to `product_work_create`. Before this, only the bootstrap fixture Coworker
 * had a binding, because the only thing that ever wrote one was a script.
 *
 * The Definition is authored through the same validate/apply pipeline the
 * Capability builder uses and bound through the same
 * `associateAgentWorkflow` seam the Capability route uses, so the binding is
 * an ordinary product record with an ordinary lineage -- not a shortcut into
 * the table.
 */
export class EnsureCoworkerDefaultCapability {
  public constructor(
    private readonly definitions: Pick<ProductWorkDefinitionApi, 'apply'>,
    private readonly catalog: Pick<
      WorkDefinitionSourceRepository,
      'associateAgentWorkflow'
    >,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async execute(input: {
    readonly draft: CoworkerAuthoringDraft;
    readonly agentDefinitionId: string;
    /** The Agent's owner, which is also the scope its runtime grant runs in. */
    readonly accessContext: AccessContext;
    readonly idempotencyKey: string;
  }): Promise<CoworkerDefaultCapability | null> {
    if (!this.catalog.associateAgentWorkflow) return null;
    const compiled = compileCoworkerDefaultCapability(input.draft);
    const applied = await this.definitions.apply({
      source: compiled.source,
      idempotencyKey: input.idempotencyKey,
      accessContext: input.accessContext,
    });
    // The binding has to be written in the Agent's owner scope, not the
    // hiring person's: a Coworker chat turn runs under the Agent's owner, so
    // a binding filed under the human would be invisible to the very tool
    // (`list_agent_workflows`) it exists to answer.
    await this.catalog.associateAgentWorkflow({
      tenantId: input.accessContext.tenantId,
      workspaceId: input.accessContext.workspaceId,
      principalType: input.accessContext.principalType,
      principalId: input.accessContext.principalId,
      agentDefinitionId: input.agentDefinitionId,
      definitionId: applied.definition.id,
      definitionVersionId: applied.version.version.id,
      now: this.now().toISOString(),
    });
    return {
      definitionId: applied.definition.id,
      definitionVersionId: applied.version.version.id,
      normalizedName: compiled.normalizedName,
    };
  }
}
