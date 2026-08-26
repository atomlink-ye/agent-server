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
  /** Fingerprint of the internal composition source. */
  readonly fingerprint: string;
  /** Normalized Product author document; omitted by legacy/internal callers. */
  readonly authorSource?: Readonly<Record<string, unknown>>;
  /** Stable fingerprint of authorSource. */
  readonly authorFingerprint?: string;
  readonly now: string;
}

export interface ProductWorkDefinitionVersionRecord {
  readonly version: WorkDefinitionSourceVersion;
  readonly authorSource: Readonly<Record<string, unknown>>;
  readonly authorFingerprint: string;
  readonly resolvedFingerprint: string | null;
}

export interface WorkDefinitionVersionListPage {
  readonly items: readonly ProductWorkDefinitionVersionRecord[];
  readonly nextCursor: string | null;
}

export interface ProductWorkDefinitionSelectorRecord {
  readonly definition: WorkDefinitionSourceDefinition;
  readonly displayName: string;
  readonly currentPublishedVersionId: string;
}

export interface WorkDefinitionApplyRequestRecord {
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly definitionId: string;
  readonly versionId: string;
  readonly resolvedFingerprint: string;
  readonly createdAt: string;
}

export interface AgentWorkBindingScope {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
  readonly agentDefinitionId: string;
}

/**
 * Internal immutable source registry behind the Composition compiler plus the
 * minimal Product metadata needed by the Developer API facade.
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
  publish(input: PublishWorkDefinitionSourceInput): Promise<{
    readonly definition: WorkDefinitionSourceDefinition;
    readonly version: WorkDefinitionSourceVersion;
  }>;

  findProductVersion?(
    id: string,
    owner: WorkDefinitionSourceOwner,
  ): Promise<ProductWorkDefinitionVersionRecord | null>;
  findProductVersionByAuthorFingerprint?(input: {
    readonly definitionId: string;
    readonly owner: WorkDefinitionSourceOwner;
    readonly authorFingerprint: string;
  }): Promise<ProductWorkDefinitionVersionRecord | null>;
  listProductVersions?(input: {
    readonly definitionId: string;
    readonly owner: WorkDefinitionSourceOwner;
    readonly limit: number;
    readonly cursor: string | null;
  }): Promise<WorkDefinitionVersionListPage>;
  listProductDefinitions?(input: {
    readonly owner: WorkDefinitionSourceOwner;
    readonly limit: number;
  }): Promise<readonly ProductWorkDefinitionSelectorRecord[]>;
  recordResolvedFingerprint?(input: {
    readonly versionId: string;
    readonly owner: WorkDefinitionSourceOwner;
    readonly resolvedFingerprint: string;
    readonly now: string;
  }): Promise<string>;
  findApplyRequest?(input: {
    readonly owner: WorkDefinitionSourceOwner;
    readonly idempotencyKey: string;
  }): Promise<WorkDefinitionApplyRequestRecord | null>;
  recordApplyRequest?(input: {
    readonly owner: WorkDefinitionSourceOwner;
    readonly idempotencyKey: string;
    readonly requestFingerprint: string;
    readonly definitionId: string;
    readonly versionId: string;
    readonly resolvedFingerprint: string;
    readonly now: string;
  }): Promise<WorkDefinitionApplyRequestRecord>;
  associateAgentWorkflow?(
    input: AgentWorkBindingScope & {
      readonly definitionId: string;
      readonly definitionVersionId: string;
      readonly now: string;
    },
  ): Promise<void>;
  listDefinitionsForAgent?(
    input: AgentWorkBindingScope,
  ): Promise<readonly WorkDefinitionSourceDefinition[]>;
  listAgentWorkBindings?(input: AgentWorkBindingScope): Promise<
    readonly {
      readonly definition: WorkDefinitionSourceDefinition;
      readonly version: WorkDefinitionSourceVersion;
    }[]
  >;
}
