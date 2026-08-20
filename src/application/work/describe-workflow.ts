import type { AccessContext } from '../../platform/access-context.js';
import type {
  ProductWorkDefinitionVersionRecord,
  WorkDefinitionSourceRepository,
} from '../ports/work-definition-source-repository.js';
import type { WorkDefinitionSourceDefinition } from '../../domain/work/work-definition-source.js';
import type { WorkInputSchema } from '../../domain/work/work-input-schema.js';
import { ProductWorkDefinitionQuery } from './product-work-definition-query.js';

export interface DescribeWorkflowResult {
  readonly definition: WorkDefinitionSourceDefinition;
  readonly version: ProductWorkDefinitionVersionRecord;
  readonly inputContract: {
    readonly name: string;
    readonly description: string | null;
    readonly schema: WorkInputSchema;
  } | null;
}

export class DescribeWorkflow {
  private readonly query: ProductWorkDefinitionQuery;

  constructor(repository: WorkDefinitionSourceRepository) {
    this.query = new ProductWorkDefinitionQuery(repository);
  }

  async execute(input: {
    readonly definitionId: string;
    readonly versionId?: string;
    readonly accessContext: AccessContext;
  }): Promise<DescribeWorkflowResult> {
    let resolvedVersion: ProductWorkDefinitionVersionRecord;
    let definition: WorkDefinitionSourceDefinition;

    if (input.versionId) {
      // Get the version first
      resolvedVersion = await this.query.getVersion({
        versionId: input.versionId,
        accessContext: input.accessContext,
      });

      // Get the definition separately
      const defResult = await this.query.getDefinition({
        definitionId: input.definitionId,
        accessContext: input.accessContext,
      });
      definition = defResult.definition;

      // Verify the version belongs to this definition
      if (resolvedVersion.version.definitionId !== input.definitionId) {
        throw new Error(
          'The version does not belong to the specified definition.',
        );
      }
    } else {
      // Get definition and use its latest version
      const defResult = await this.query.getDefinition({
        definitionId: input.definitionId,
        accessContext: input.accessContext,
      });
      definition = defResult.definition;

      if (!defResult.latestVersion) {
        throw new Error('The definition has no versions.');
      }
      resolvedVersion = defResult.latestVersion;
    }

    // Get the input contract
    const inputContract = await this.query.getInputContract({
      versionId: resolvedVersion.version.id,
      accessContext: input.accessContext,
    });

    return {
      definition,
      version: resolvedVersion,
      inputContract,
    };
  }
}
