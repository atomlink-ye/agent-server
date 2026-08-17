import type { AccessContext } from '../../platform/access-context.js';
import type { WorkInputSchema } from '../../domain/work/work-input-schema.js';
import type {
  ProductWorkDefinitionVersionRecord,
  WorkDefinitionSourceOwner,
  WorkDefinitionSourceRepository,
} from '../ports/work-definition-source-repository.js';
import type { WorkDefinitionSourceDefinition } from '../../domain/work/work-definition-source.js';
import { validateProductWorkDefinition } from './validate-product-work-definition.js';

export class ProductWorkDefinitionQuery {
  public constructor(private readonly repository: WorkDefinitionSourceRepository) {}

  public async getDefinition(input: {
    readonly definitionId: string;
    readonly accessContext: AccessContext;
  }): Promise<{
    readonly definition: WorkDefinitionSourceDefinition;
    readonly latestVersion: ProductWorkDefinitionVersionRecord | null;
  }> {
    this.assertRepositorySupport();
    const owner = ownerFromAccessContext(input.accessContext);
    const definition = await this.repository.findDefinition(
      input.definitionId,
      owner,
    );
    if (!definition) throw new ProductWorkDefinitionNotFoundError();
    const page = await this.repository.listProductVersions!({
      definitionId: definition.id,
      owner,
      limit: 1,
      cursor: null,
    });
    return { definition, latestVersion: page.items[0] ?? null };
  }

  public async listVersions(input: {
    readonly definitionId: string;
    readonly accessContext: AccessContext;
    readonly limit: number;
    readonly cursor: string | null;
  }) {
    this.assertRepositorySupport();
    const owner = ownerFromAccessContext(input.accessContext);
    const definition = await this.repository.findDefinition(
      input.definitionId,
      owner,
    );
    if (!definition) throw new ProductWorkDefinitionNotFoundError();
    return this.repository.listProductVersions!({
      definitionId: input.definitionId,
      owner,
      limit: input.limit,
      cursor: input.cursor,
    });
  }

  public async getVersion(input: {
    readonly versionId: string;
    readonly accessContext: AccessContext;
  }): Promise<ProductWorkDefinitionVersionRecord> {
    this.assertRepositorySupport();
    const owner = ownerFromAccessContext(input.accessContext);
    const version = await this.repository.findProductVersion!(
      input.versionId,
      owner,
    );
    if (!version) throw new ProductWorkDefinitionNotFoundError();
    return version;
  }

  public async getInputContract(input: {
    readonly versionId: string;
    readonly accessContext: AccessContext;
  }): Promise<{
    readonly name: string;
    readonly description: string | null;
    readonly schema: WorkInputSchema;
  } | null> {
    if (!this.repository.findProductVersion) return null;
    const owner = ownerFromAccessContext(input.accessContext);
    const version = await this.repository.findProductVersion(
      input.versionId,
      owner,
    );
    if (!version) return null;
    const parsed = validateProductWorkDefinition(
      JSON.stringify(version.authorSource),
    );
    if (!parsed.valid)
      throw new Error('Persisted Product Work Definition is invalid.');
    return {
      name: parsed.document.metadata.name,
      description: parsed.document.metadata.description ?? null,
      schema: parsed.document.spec.input_schema,
    };
  }

  private assertRepositorySupport(): void {
    if (
      !this.repository.findProductVersion ||
      !this.repository.listProductVersions
    )
      throw new Error('Product Work Definition repository is unavailable.');
  }
}

export class ProductWorkDefinitionNotFoundError extends Error {
  public readonly code = 'work_definition_not_found';
  public constructor() {
    super('The requested Work Definition was not found.');
    this.name = 'ProductWorkDefinitionNotFoundError';
  }
}

export function ownerFromAccessContext(
  access: AccessContext,
): WorkDefinitionSourceOwner {
  return {
    tenantId: access.tenantId,
    workspaceId: access.workspaceId,
    principalType: access.principalType,
    principalId: access.principalId,
  };
}
