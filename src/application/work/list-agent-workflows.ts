import type { AccessContext } from '../../platform/access-context.js';
import type { WorkDefinitionSourceDefinition } from '../../domain/work/work-definition-source.js';
import type { WorkDefinitionSourceRepository } from '../ports/work-definition-source-repository.js';

export class ListAgentWorkflows {
  constructor(
    private readonly repository: Pick<
      WorkDefinitionSourceRepository,
      'listDefinitionsForAgent'
    >,
  ) {}

  async execute(input: {
    readonly agentDefinitionId: string;
    readonly accessContext: AccessContext;
  }): Promise<{
    readonly definitions: readonly WorkDefinitionSourceDefinition[];
  }> {
    if (!this.repository.listDefinitionsForAgent)
      throw new Error('Agent workflow discovery is unavailable.');
    const definitions = await this.repository.listDefinitionsForAgent({
      tenantId: input.accessContext.tenantId,
      workspaceId: input.accessContext.workspaceId,
      agentDefinitionId: input.agentDefinitionId,
    });
    return { definitions };
  }
}
