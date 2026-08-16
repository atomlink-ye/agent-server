import { createHash } from 'node:crypto';

import { importAgent } from '../agents/import-agent.js';
import { publishAgentVersion } from '../agents/publish-agent-version.js';
import { parseForImport } from '../agents/validate-agent-package.js';
import {
  importEnvironment,
  publishEnvironmentVersion,
  validateEnvironmentPackage,
} from '../environments/environment-use-cases.js';
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
import { createTeamDefinition } from '../../domain/invokables/team-definition.js';
import {
  createDraftTeamVersion,
  publishTeamVersion,
  type TeamSpec,
  type TeamVersion,
} from '../../domain/invokables/team-version.js';
import {
  fingerprintWorkDefinitionSource,
  type WorkDefinitionCompositionSource,
  type WorkDefinitionSourceDefinition,
} from '../../domain/work/work-definition-source.js';
import type { WorkInputSchema } from '../../domain/work/work-input-schema.js';
import type { AccessContext } from '../../platform/access-context.js';
import {
  validateProductWorkDefinition,
  type ProductWorkDefinitionDocument,
  type ProductWorkParticipantBinding,
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

export class ProductWorkDefinitionApi {
  private readonly now: () => Date;

  public constructor(private readonly options: ProductWorkDefinitionApiOptions) {
    this.now = options.now ?? (() => new Date());
  }

  public async plan(input: {
    readonly source: string;
    readonly accessContext: AccessContext;
  }): Promise<ProductWorkDefinitionPlan> {
    const parsed = validateProductWorkDefinition(input.source);
    if (!parsed.valid) throw new InvalidProductWorkDefinitionError(parsed.diagnostics);
    const owner = ownerFromAccessContext(input.accessContext);
    const inspection = await this.inspectReferences(parsed.document, owner);
    const needsPlatformMcp = inspection.participants.some(
      (participant) => participant.skills.length > 0 || participant.tools.length > 0,
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
    if (!parsed.valid) throw new InvalidProductWorkDefinitionError(parsed.diagnostics);
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

    const definitionId = stableUuid(
      `work-definition\0${ownerKey(owner)}\0${parsed.metadata.normalizedName}`,
    );
    const versionId = stableUuid(
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

    // Validate all referenced and inline packages before any materialization.
    await this.inspectReferences(parsed.document, owner);
    const composition = await this.materializeComposition({
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

  public async getDefinition(input: {
    readonly definitionId: string;
    readonly accessContext: AccessContext;
  }): Promise<{
    readonly definition: WorkDefinitionSourceDefinition;
    readonly latestVersion: ProductWorkDefinitionVersionRecord | null;
  }> {
    this.assertRepositorySupportsProductLifecycle();
    const owner = ownerFromAccessContext(input.accessContext);
    const definition = await this.options.repository.findDefinition(
      input.definitionId,
      owner,
    );
    if (!definition) throw new ProductWorkDefinitionNotFoundError();
    const page = await this.options.repository.listProductVersions!({
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
    this.assertRepositorySupportsProductLifecycle();
    const owner = ownerFromAccessContext(input.accessContext);
    const definition = await this.options.repository.findDefinition(
      input.definitionId,
      owner,
    );
    if (!definition) throw new ProductWorkDefinitionNotFoundError();
    return this.options.repository.listProductVersions!({
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
    this.assertRepositorySupportsProductLifecycle();
    const owner = ownerFromAccessContext(input.accessContext);
    const version = await this.options.repository.findProductVersion!(
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
    if (!this.options.repository.findProductVersion) return null;
    const owner = ownerFromAccessContext(input.accessContext);
    const version = await this.options.repository.findProductVersion(
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

  private async inspectReferences(
    document: ProductWorkDefinitionDocument,
    owner: WorkDefinitionSourceOwner,
  ): Promise<{
    readonly participants: ProductWorkDefinitionPlan['participants'];
    readonly environment: ProductWorkDefinitionPlan['environment'];
  }> {
    const bindings: readonly {
      readonly name: string;
      readonly role: 'primary' | 'lead' | 'member';
      readonly binding: ProductWorkParticipantBinding | SingleAgentBinding;
      readonly path: string;
    }[] =
      document.spec.kind === 'single_agent'
        ? [
            {
              name: document.metadata.name,
              role: 'primary',
              binding: document.spec,
              path: '$.spec',
            },
          ]
        : [
            {
              name: document.spec.lead.name,
              role: 'lead',
              binding: document.spec.lead,
              path: '$.spec.lead',
            },
            ...document.spec.members.map((member, index) => ({
              name: member.name,
              role: 'member' as const,
              binding: member,
              path: `$.spec.members[${index}]`,
            })),
          ];

    const participants: Array<
      ProductWorkDefinitionPlan['participants'][number]
    > = [];
    for (const item of bindings) {
      if (item.binding.agent_version_id) {
        const agent = await this.options.agents.resolvePublished(
          item.binding.agent_version_id,
          owner,
          { resolveExtensions: true },
        );
        if (!agent)
          throw new ProductWorkDefinitionReferenceError(
            `${item.path}.agent_version_id`,
            'Referenced Agent version was not found or is not published in this owner scope.',
          );
        participants.push(
          Object.freeze({
            name: item.name,
            role: item.role,
            source: 'referenced' as const,
            agentVersionId: item.binding.agent_version_id,
            skills: Object.freeze(agent.skills.map((skill) => skill.ref)),
            tools: Object.freeze([...agent.toolRefs]),
          }),
        );
        continue;
      }

      const inline = item.binding.agent?.source;
      if (!inline)
        throw new ProductWorkDefinitionReferenceError(
          `${item.path}.agent`,
          'An inline Agent source is required.',
        );
      try {
        const parsed = parseForImport(inline);
        participants.push(
          Object.freeze({
            name: item.name,
            role: item.role,
            source: 'inline' as const,
            agentVersionId: null,
            skills: Object.freeze(
              parsed.package.spec.skills.map((skill) => skill.ref),
            ),
            tools: Object.freeze(
              parsed.package.spec.tools.map((tool) => tool.ref),
            ),
          }),
        );
      } catch {
        throw new ProductWorkDefinitionReferenceError(
          `${item.path}.agent.source`,
          'Inline Agent source is invalid.',
        );
      }
    }

    const environmentBinding = document.spec;
    let environment: ProductWorkDefinitionPlan['environment'];
    if (environmentBinding.environment_version_id) {
      const version = await this.options.environments.findVersion(
        owner,
        environmentBinding.environment_version_id,
      );
      if (!version || version.status !== 'published')
        throw new ProductWorkDefinitionReferenceError(
          '$.spec.environment_version_id',
          'Referenced Environment version was not found or is not published in this owner scope.',
        );
      environment = Object.freeze({
        source: 'referenced' as const,
        environmentVersionId: environmentBinding.environment_version_id,
      });
    } else {
      const source = environmentBinding.environment?.source;
      if (!source)
        throw new ProductWorkDefinitionReferenceError(
          '$.spec.environment',
          'An inline Environment source is required.',
        );
      try {
        validateEnvironmentPackage(source);
      } catch {
        throw new ProductWorkDefinitionReferenceError(
          '$.spec.environment.source',
          'Inline Environment source is invalid.',
        );
      }
      environment = Object.freeze({
        source: 'inline' as const,
        environmentVersionId: null,
      });
    }

    if (document.spec.memory_version_ids.length > 0) {
      if (!this.options.memories)
        throw new ProductWorkDefinitionReferenceError(
          '$.spec.memory_version_ids',
          'Memory version resolution is unavailable.',
        );
      for (const [index, versionId] of document.spec.memory_version_ids.entries()) {
        const memory = await this.options.memories.findVersion(versionId, owner);
        if (!memory)
          throw new ProductWorkDefinitionReferenceError(
            `$.spec.memory_version_ids[${index}]`,
            'Referenced Memory version was not found in this owner scope.',
          );
      }
    }

    return {
      participants: Object.freeze(participants),
      environment,
    };
  }

  private async materializeComposition(input: {
    readonly document: ProductWorkDefinitionDocument;
    readonly owner: WorkDefinitionSourceOwner;
    readonly accessContext: AccessContext;
    readonly definitionId: string;
    readonly versionId: string;
    readonly authorFingerprint: string;
  }): Promise<WorkDefinitionCompositionSource> {
    const environmentVersionId = await this.materializeEnvironment(
      input.document.spec,
      input.accessContext,
    );
    const common = {
      environmentVersionId,
      memoryVersionIds: Object.freeze([
        ...input.document.spec.memory_version_ids,
      ]),
      description: input.document.metadata.description ?? null,
      inputSchema: input.document.spec.input_schema,
    };

    if (input.document.spec.kind === 'single_agent') {
      const agentVersionId = await this.materializeAgent(
        input.document.spec,
        input.accessContext,
      );
      return Object.freeze({
        kind: 'single_agent' as const,
        agentVersionId,
        ...common,
      });
    }

    const leadVersionId = await this.materializeAgent(
      input.document.spec.lead,
      input.accessContext,
    );
    const members: TeamSpec['roster'][number][] = [];
    for (const member of input.document.spec.members) {
      members.push({
        name: member.name,
        agentVersionId: await this.materializeAgent(
          member,
          input.accessContext,
        ),
      });
    }
    const teamVersionId = await this.materializeInternalTeam({
      owner: input.owner,
      definitionId: input.definitionId,
      versionId: input.versionId,
      authorFingerprint: input.authorFingerprint,
      name: input.document.metadata.name,
      description: input.document.metadata.description ?? null,
      spec: {
        lead: {
          name: input.document.spec.lead.name,
          agentVersionId: leadVersionId,
        },
        roster: members,
        environmentVersionId,
      },
    });
    return Object.freeze({
      kind: 'collaboration' as const,
      teamVersionId,
      ...common,
    });
  }

  private async materializeAgent(
    binding: ProductWorkParticipantBinding | SingleAgentBinding,
    accessContext: AccessContext,
  ): Promise<string> {
    if (binding.agent_version_id) return binding.agent_version_id;
    const source = binding.agent?.source;
    if (!source || !this.options.agentRegistry)
      throw new ProductWorkDefinitionReferenceError(
        '$.spec.agent',
        'Inline Agent materialization is unavailable.',
      );
    const digest = sha256Hex(source);
    const imported = await importAgent(this.options.agentRegistry, {
      accessContext,
      idempotencyKey: `work-inline-agent-import:${digest}`,
      source,
    });
    if (imported.version.status === 'published') return imported.version.id;
    const published = await publishAgentVersion(this.options.agentRegistry, {
      accessContext,
      idempotencyKey: `work-inline-agent-publish:${digest}`,
      versionId: imported.version.id,
    });
    return published.id;
  }

  private async materializeEnvironment(
    binding: EnvironmentBinding,
    accessContext: AccessContext,
  ): Promise<string> {
    if (binding.environment_version_id) return binding.environment_version_id;
    const source = binding.environment?.source;
    if (!source || !this.options.environmentRegistry)
      throw new ProductWorkDefinitionReferenceError(
        '$.spec.environment',
        'Inline Environment materialization is unavailable.',
      );
    const digest = sha256Hex(source);
    const imported = await importEnvironment(this.options.environmentRegistry, {
      accessContext,
      idempotencyKey: `work-inline-environment-import:${digest}`,
      source,
    });
    if (imported.version.status === 'published') return imported.version.id;
    const published = await publishEnvironmentVersion(
      this.options.environmentRegistry,
      {
        accessContext,
        idempotencyKey: `work-inline-environment-publish:${digest}`,
        versionId: imported.version.id,
      },
    );
    return published.id;
  }

  private async materializeInternalTeam(input: {
    readonly owner: WorkDefinitionSourceOwner;
    readonly definitionId: string;
    readonly versionId: string;
    readonly authorFingerprint: string;
    readonly name: string;
    readonly description: string | null;
    readonly spec: TeamSpec;
  }): Promise<string> {
    const teamDefinitionId = stableUuid(
      `work-definition-team\0${input.definitionId}`,
    );
    const teamVersionId = stableUuid(
      `work-definition-team-version\0${input.versionId}`,
    );
    const existing = await this.options.invokables.findTeamVersionById(
      teamVersionId,
    );
    if (existing) {
      assertInternalTeam(
        existing,
        input.owner,
        teamDefinitionId,
        input.spec,
      );
      if (existing.status === 'published') return existing.id;
    }

    const clock = () => this.now();
    const definition = createTeamDefinition({
      ...input.owner,
      id: teamDefinitionId,
      name: `work-${input.name}`,
      description: 'Internal execution binding for Product Work Definition.',
      now: clock,
    });
    const draft = createDraftTeamVersion({
      ...input.owner,
      id: teamVersionId,
      definitionId: teamDefinitionId,
      name: input.name,
      description: input.description,
      spec: input.spec,
      now: clock,
    });
    const imported = this.options.invokables.importTeamVersionAtomically
      ? await this.options.invokables.importTeamVersionAtomically({
          definition,
          version: draft,
          idempotencyKey: `product-work-team-import:${input.definitionId}:${input.authorFingerprint}`,
          requestFingerprint: input.authorFingerprint,
        })
      : (await this.options.invokables.saveTeamDefinition(definition),
        await this.options.invokables.saveTeamVersion(draft),
        { kind: 'created' as const, definition, version: draft });
    if (imported.version.status === 'published') return imported.version.id;

    const published = publishTeamVersion(imported.version, clock);
    if (this.options.invokables.publishTeamVersionAtomically)
      await this.options.invokables.publishTeamVersionAtomically({
        version: published,
        idempotencyKey: `product-work-team-publish:${input.definitionId}:${input.authorFingerprint}`,
        requestFingerprint: input.authorFingerprint,
      });
    else await this.options.invokables.saveTeamVersion(published);
    return published.id;
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

export class ProductWorkDefinitionReferenceError extends Error {
  public readonly code = 'invalid_reference';
  public constructor(
    public readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProductWorkDefinitionReferenceError';
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

export class ProductWorkDefinitionNotFoundError extends Error {
  public readonly code = 'work_definition_not_found';
  public constructor() {
    super('The requested Work Definition was not found.');
    this.name = 'ProductWorkDefinitionNotFoundError';
  }
}

type SingleAgentBinding = Extract<
  ProductWorkDefinitionDocument['spec'],
  { readonly kind: 'single_agent' }
>;
type EnvironmentBinding = Pick<
  ProductWorkDefinitionDocument['spec'],
  'environment_version_id' | 'environment'
>;

function ownerFromAccessContext(
  access: AccessContext,
): WorkDefinitionSourceOwner {
  return {
    tenantId: access.tenantId,
    workspaceId: access.workspaceId,
    principalType: access.principalType,
    principalId: access.principalId,
  };
}

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

function stableUuid(seed: string): string {
  const hex = createHash('sha256')
    .update(seed, 'utf8')
    .digest('hex')
    .slice(0, 32)
    .split('');
  hex[12] = '5';
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function assertInternalTeam(
  version: TeamVersion,
  owner: WorkDefinitionSourceOwner,
  definitionId: string,
  spec: TeamSpec,
): void {
  if (
    version.definitionId !== definitionId ||
    version.tenantId !== owner.tenantId ||
    version.workspaceId !== owner.workspaceId ||
    version.principalType !== owner.principalType ||
    version.principalId !== owner.principalId ||
    JSON.stringify(version.spec) !== JSON.stringify(spec)
  )
    throw new Error('Internal Product Work Team binding conflict.');
}
