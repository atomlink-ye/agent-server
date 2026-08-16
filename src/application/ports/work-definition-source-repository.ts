import type {
  WorkDefinitionCompositionSource,
  WorkDefinitionSourceDefinition,
  WorkDefinitionSourceVersion,
} from '../../domain/work/work-definition-source.js';

export type WorkDefinitionSourceOwner = WorkDefinitionSourceDefinition['owner'];

export interface PublishWorkDefinitionSourceInput {
  readonly definitionId: string;
  readonly versionId: string;
  readonly owner: WorkDefinitionSourceOwner;
  readonly name: string;
  readonly description: string | null;
  readonly source: WorkDefinitionCompositionSource;
  readonly fingerprint: string;
  readonly now: string;
}

/**
 * Internal immutable source registry behind the Composition compiler. It is not
 * the public Developer API; that product facade can publish into this seam later.
 */
export interface WorkDefinitionSourceRepository {
  findDefinition(
    id: string,
    owner: WorkDefinitionSourceOwner,
  ): Promise<WorkDefinitionSourceDefinition | null>;
  findPublishedVersion(
    id: string,
    owner: WorkDefinitionSourceOwner,
  ): Promise<WorkDefinitionSourceVersion | null>;
  publish(
    input: PublishWorkDefinitionSourceInput,
  ): Promise<{
    readonly definition: WorkDefinitionSourceDefinition;
    readonly version: WorkDefinitionSourceVersion;
  }>;
}
