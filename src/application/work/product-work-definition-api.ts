import type { AgentRegistry } from '../ports/agent-registry.js';
import type { AgentResolutionApi } from '../ports/agent-resolution-api.js';
import type { EnvironmentRegistry } from '../ports/environment-registry.js';
import type { InvokableRepository } from '../ports/invokable-repository.js';
import type { MemoryVersionReadApi } from '../ports/memory-version-read-api.js';
import type {
  ProductWorkDefinitionVersionRecord,
  WorkDefinitionSourceOwner,
  WorkDefinitionSourceRepository,
} from '../ports/work-definition-source-repository.js';
import type { WorkDefinitionResolutionPort } from '../ports/work-definition-resolution.js';
import {
  fingerprintWorkDefinitionSource,
  type WorkDefinitionSourceDefinition,
} from '../../domain/work/work-definition-source.js';
import type { AccessContext } from '../../platform/access-context.js';
import {
  ProductWorkDefinitionInspector,
  ProductWorkDefinitionMaterializer,
  stableProductUuid,
} from './product-work-definition-composition.js';
import {
  ProductWorkDefinitionQuery,
  ownerFromAccessContext,
} from './product-work-definition-query.js';
import {
  validateProductWorkDefinition,
  type WorkDefinitionDiagnostic,
} from './validate-product-work-definition.js';

const MAX_IDEMPOTENCY_KEY_BYTES = 256;

type PlanResourceSource = 'referenced' | 'inline';

export interface ProductWorkDefinitionApplyResult {
  readonly result: 'created' | 'converged' | 'replayed';
  readonly definition: WorkDefinitionSourceDefinition;
  readonly version: ProductWorkDefinitionVersionRecord;
}

export interface ProductWorkDefinitionPlan {
  readonly fingerprint: string;
  readonly normalizedName: string;
  readonly kind: 'single_agent' | 'collaboration';
  readonly participants: readonly {
    readonly name: string;
    readonly role: 'primary' | 'lead' | 'member';
    readonly source: PlanResourceSource;
    readonly agentVersionId: string | null;
    readonly skills: readonly string[];
    readonly tools: readonly string[];
  }[];
  readonly environment: {
    readonly source: PlanResourceSource;
    readonly environmentVersionId: string | null;
  };
  readonly memoryVersionIds: readonly string[];
  readonly requiredRuntimeCapabilities: readonly string[];
  readonly platformCapabilities: readonly string[];
  readonly materialization: {
    readonly inlineAgents: number;
    readonly inlineEnvironment: boolean;
    readonly internalTeam: boolean;
  };
}

export interface ProductWorkDefinitionApiOptions {
  readonly repository: WorkDefinitionSourceRepository;
  readonly resolver: WorkDefinitionResolutionPort;
  readonly agents: AgentResolutionApi;
  /** Required only when a Product Definition embeds inline Agent packages. */
  readonly agentRegistry?: AgentRegistry;
  readonly invokables: Pick<
    InvokableRepository,
    | 'saveTeamDefinition'
    | 'findTeamDefinitionById'
    | 'saveTeamVersion'
    | 'findTeamVersionById'
    | 'importTeamVersionAtomically'
    | 'publishTeamVersionAtomically'
  >;
  readonly environments: Pick<EnvironmentRegistry, 'findVersion'>;
  /** Required only when a Product Definition embeds an inline Environment. */
  readonly environmentRegistry?: EnvironmentRegistry;
  readonly memories?: MemoryVersionReadApi;
  readonly now?: () => Date;
}

/**
 * Product facade over small planning/materialization/query services. It keeps the
 * HTTP-facing lifecycle stable while each composition concern can evolve during
 * subsequent MVE probes without growing another all-purpose coordinator.
 */
export class ProductWorkDefinitionApi {
  private readonly now: () => Date;
  private readonly inspector: ProductWorkDefinitionInspector;
  private readonly materializer: ProductWorkDefinitionMaterializer;
  private readonly query: ProductWorkDefinitionQuery;

  public constructor(private readonly options: ProductWorkDefinitionApiOptions) {
    this.now = options.now ?? (() => new Date());
    this.inspector = new ProductWorkDefinitionInspector({
      agents: options.agents,
      environments: options.environments,
      ...(options.memories ? { memories: options.memories } : {}),
    });
    this.materializer = new ProductWorkDefinitionMaterializer({
      invokables: options.invokables,
      ...(options.agentRegistry ? { agentRegistry: options.agentRegistry } : {}),
      ...(options.environmentRegistry
        ? { environmentRegistry: options.environmentRegistry }
        : {}),
      now: this.now,
    });
    this.query = new ProductWorkDefinitionQuery(options.repository);
  }

  public async plan(input: {
    readonly source: string;
    readonly accessContext: AccessContext;
  }): Promise<ProductWorkDefinitionPlan> {
    const parsed = validateProductWorkDefinition(input.source);
    if (!parsed.valid)
      throw new InvalidProductWorkDefinitionError(parsed.diagnostics);
    const owner = ownerFromAccessContext(input.accessContext);
    const inspection = await this.inspector.inspect(parsed.document, owner);
    const needsPlatformMcp = inspection.participants.some(
      (participant) =>
        participant.skills.length > 0 || participant.tools.length > 0,
    );
    return {
      fingerprint: parsed.fingerprint,
      normalizedName: parsed.metadata.normalizedName,
      kind: parsed.document.spec.kind,
      participants: inspection.participants,
      environment: inspection.environment,
      memoryVersionIds: parsed.document.spec.memory_version_ids,
      requiredRuntimeCapabilities:
        parsed.document.spec.kind === 'collaboration'
          ? ['reusable_session', 'external_workspace', 'platform_mcp']
          : [
              'external_workspace',
              ...(needsPlatformMcp ? ['platform_mcp'] : []),
            ],
      platformCapabilities:
        parsed.document.spec.kind === 'collaboration'
          ? ['collaboration', 'platform_mcp']
          : needsPlatformMcp
            ? ['platform_mcp']
            : [],
      materialization: {
        inlineAgents: inspection.participants.filter(
          (participant) => participant.source === 'inline',
        ).length,
        inlineEnvironment: inspection.environment.source === 'inline',
        internalTeam: parsed.document.spec.kind === 'collaboration',
      },
    };
  }

  public async apply(input: {
    readonly source: string;
    readonly idempotencyKey: string;
    readonly accessContext: AccessContext;
  }): Promise<ProductWorkDefinitionApplyResult> {
    assertIdempotencyKey(input.idempotencyKey);
    const parsed = validateProductWorkDefinition(input.source);
    if (!parsed.valid)
      throw new InvalidProductWorkDefinitionError(parsed.diagnostics);
    const owner = ownerFromAccessContext(input.accessContext);
    this.assertRepositorySupportsProductLifecycle();

    const replay = await this.options.repository.findApplyRequest!({
      owner,
      idempotencyKey: input.idempotencyKey,
    });
    if (replay) {
      if (replay.requestFingerprint !== parsed.fingerprint)
        throw new ProductWorkDefinitionIdempotencyConflictError();
      const [definition, version] = await Promise.all([
        this.options.repository.findDefinition(replay.definitionId, owner),
        this.options.repository.findProductVersion!(replay.versionId, owner),
      ]);
      if (!definition || !version)
        throw new Error('Product Work Definition replay target is unavailable.');
      return { result: 'replayed', definition, version };
    }

    const definitionId = stableProductUuid(
      `work-definition\0${ownerKey(owner)}\0${parsed.metadata.normalizedName}`,
    );
    const versionId = stableProductUuid(
      `work-definition-version\0${definitionId}\0${parsed.fingerprint}`,
    );

    const converged =
      await this.options.repository.findProductVersionByAuthorFingerprint!({
        definitionId,
        owner,
        authorFingerprint: parsed.fingerprint,
      });
    if (converged) {
      const definition = await this.options.repository.findDefinition(
        definitionId,
        owner,
      );
      if (!definition)
        throw new Error('Product Work Definition identity is unavailable.');
      const resolvedFingerprint =
        converged.resolvedFingerprint ??
        (await this.resolveAndRecord(
          definitionId,
          converged.version.id,
          owner,
          input.accessContext,
        ));
      await this.options.repository.recordApplyRequest!({
        owner,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: parsed.fingerprint,
        definitionId,
        versionId: converged.version.id,
        resolvedFingerprint,
        now: this.now().toISOString(),
      });
      const version = await this.options.repository.findProductVersion!(
        converged.version.id,
        owner,
      );
      if (!version)
        throw new Error('Product Work Definition version is unavailable.');
      return { result: 'converged', definition, version };
    }

    // Keep validation/reference inspection side-effect free before materializing
    // any inline Agent, Environment, or internal collaboration binding.
    await this.inspector.inspect(parsed.document, owner);
    const composition = await this.materializer.materialize({
      document: parsed.document,
      owner,
      accessContext: input.accessContext,
      definitionId,
      versionId,
      authorFingerprint: parsed.fingerprint,
    });
    const internalFingerprint = fingerprintWorkDefinitionSource(composition);
    const now = this.now().toISOString();
    const published = await this.options.repository.publish({
      definitionId,
      versionId,
      owner,
      name: parsed.metadata.normalizedName,
      description: parsed.document.metadata.description ?? null,
      source: composition,
      fingerprint: internalFingerprint,
      authorSource:
        parsed.document as unknown as Readonly<Record<string, unknown>>,
      authorFingerprint: parsed.fingerprint,
      now,
    });
    const resolvedFingerprint = await this.resolveAndRecord(
      published.definition.id,
      published.version.id,
      owner,
      input.accessContext,
    );
    await this.options.repository.recordApplyRequest!({
      owner,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: parsed.fingerprint,
      definitionId: published.definition.id,
      versionId: published.version.id,
      resolvedFingerprint,
      now,
    });
    const version = await this.options.repository.findProductVersion!(
      published.version.id,
      owner,
    );
    if (!version)
      throw new Error('Product Work Definition version is unavailable.');
    return { result: 'created', definition: published.definition, version };
  }

  public getDefinition(
    input: Parameters<ProductWorkDefinitionQuery['getDefinition']>[0],
  ) {
    return this.query.getDefinition(input);
  }

  public listVersions(
    input: Parameters<ProductWorkDefinitionQuery['listVersions']>[0],
  ) {
    return this.query.listVersions(input);
  }

  public getVersion(input: Parameters<ProductWorkDefinitionQuery['getVersion']>[0]) {
    return this.query.getVersion(input);
  }

  public getInputContract(
    input: Parameters<ProductWorkDefinitionQuery['getInputContract']>[0],
  ) {
    return this.query.getInputContract(input);
  }

  private async resolveAndRecord(
    definitionId: string,
    versionId: string,
    owner: WorkDefinitionSourceOwner,
    accessContext: AccessContext,
  ): Promise<string> {
    const resolved = await this.options.resolver.resolve({
      definitionId,
      definitionVersionId: versionId,
      accessContext,
    });
    return this.options.repository.recordResolvedFingerprint!({
      versionId,
      owner,
      resolvedFingerprint: resolved.resolvedFingerprint,
      now: this.now().toISOString(),
    });
  }

  private assertRepositorySupportsProductLifecycle(): void {
    if (
      !this.options.repository.findProductVersion ||
      !this.options.repository.findProductVersionByAuthorFingerprint ||
      !this.options.repository.listProductVersions ||
      !this.options.repository.recordResolvedFingerprint ||
      !this.options.repository.findApplyRequest ||
      !this.options.repository.recordApplyRequest
    )
      throw new Error('Product Work Definition repository is unavailable.');
  }
}

export class InvalidProductWorkDefinitionError extends Error {
  public readonly code = 'invalid_definition';
  public constructor(
    public readonly diagnostics: readonly WorkDefinitionDiagnostic[],
  ) {
    super('The Work Definition is invalid.');
    this.name = 'InvalidProductWorkDefinitionError';
  }
}

export class ProductWorkDefinitionIdempotencyConflictError extends Error {
  public readonly code = 'idempotency_conflict';
  public constructor() {
    super(
      'The Idempotency-Key cannot be reused with a different Work Definition source.',
    );
    this.name = 'ProductWorkDefinitionIdempotencyConflictError';
  }
}

export {
  ProductWorkDefinitionReferenceError,
} from './product-work-definition-composition.js';
export {
  ProductWorkDefinitionNotFoundError,
} from './product-work-definition-query.js';

function assertIdempotencyKey(value: string): void {
  if (
    !value ||
    Buffer.byteLength(value, 'utf8') > MAX_IDEMPOTENCY_KEY_BYTES ||
    /[\r\n]/.test(value)
  )
    throw new ProductWorkDefinitionIdempotencyConflictError();
}

function ownerKey(owner: WorkDefinitionSourceOwner): string {
  return [
    owner.tenantId,
    owner.workspaceId,
    owner.principalType,
    owner.principalId,
  ].join('\0');
}
