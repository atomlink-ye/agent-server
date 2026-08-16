import { createHash } from 'node:crypto';

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
  type WorkDefinitionDiagnostic,
} from './validate-product-work-definition.js';

const MAX_IDEMPOTENCY_KEY_BYTES = 256;

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
    readonly agentVersionId: string;
    readonly skills: readonly string[];
    readonly tools: readonly string[];
  }[];
  readonly environmentVersionId: string;
  readonly memoryVersionIds: readonly string[];
  readonly requiredRuntimeCapabilities: readonly string[];
  readonly platformCapabilities: readonly string[];
}

export interface ProductWorkDefinitionApiOptions {
  readonly repository: WorkDefinitionSourceRepository;
  readonly resolver: WorkDefinitionResolutionPort;
  readonly agents: AgentResolutionApi;
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
    const participants = await this.inspectReferences(parsed.document, owner);
    return {
      fingerprint: parsed.fingerprint,
      normalizedName: parsed.metadata.normalizedName,
      kind: parsed.document.spec.kind,
      participants,
      environmentVersionId: parsed.document.spec.environment_version_id,
      memoryVersionIds: parsed.document.spec.memory_version_ids,
      requiredRuntimeCapabilities:
        parsed.document.spec.kind === 'collaboration'
          ? ['reusable_session', 'external_workspace', 'platform_mcp']
          : [
              'external_workspace',
              ...(participants.some(
                (participant) =>
                  participant.skills.length > 0 || participant.tools.length > 0,
              )
                ? ['platform_mcp']
                : []),
            ],
      platformCapabilities:
        parsed.document.spec.kind === 'collaboration'
          ? ['collaboration', 'platform_mcp']
          : participants.some(
                (participant) =>
                  participant.skills.length > 0 || participant.tools.length > 0,
              )
            ? ['platform_mcp']
            : [],
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

    const converged = await this.options.repository.findProductVersionByAuthorFingerprint!({
      definitionId,
      owner,
      authorFingerprint: parsed.fingerprint,
    });
    if (converged) {
      const definition = await this.options.repository.findDefinition(definitionId, owner);
      if (!definition) throw new Error('Product Work Definition identity is unavailable.');
      const resolvedFingerprint =
        converged.resolvedFingerprint ??
        (await this.resolveAndRecord(definitionId, converged.version.id, owner, input.accessContext));
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
      if (!version) throw new Error('Product Work Definition version is unavailable.');
      return { result: 'converged', definition, version };
    }

    await this.inspectReferences(parsed.document, owner);
    const composition = await this.materializeComposition({
      document: parsed.document,
      owner,
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
      authorSource: parsed.document as unknown as Readonly<Record<string, unknown>>,
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
    if (!version) throw new Error('Product Work Definition version is unavailable.');
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
    const definition = await this.options.repository.findDefinition(input.definitionId, owner);
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
    const definition = await this.options.repository.findDefinition(input.definitionId, owner);
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
    const version = await this.options.repository.findProductVersion!(input.versionId, owner);
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
    const version = await this.options.repository.findProductVersion(input.versionId, owner);
    if (!version) return null;
    const parsed = validateProductWorkDefinition(JSON.stringify(version.authorSource));
    if (!parsed.valid) throw new Error('Persisted Product Work Definition is invalid.');
    return {
      name: parsed.document.metadata.name,
      description: parsed.document.metadata.description ?? null,
      schema: parsed.document.spec.input_schema,
    };
  }

  private async inspectReferences(
    document: ProductWorkDefinitionDocument,
    owner: WorkDefinitionSourceOwner,
  ): Promise<ProductWorkDefinitionPlan['participants']> {
    const participants =
      document.spec.kind === 'single_agent'
        ? [
            {
              name: document.metadata.name,
              role: 'primary' as const,
              agentVersionId: document.spec.agent_version_id,
            },
          ]
        : [
            {
              name: document.spec.lead.name,
              role: 'lead' as const,
              agentVersionId: document.spec.lead.agent_version_id,
            },
            ...document.spec.members.map((member) => ({
              name: member.name,
              role: 'member' as const,
              agentVersionId: member.agent_version_id,
            })),
          ];
    const resolvedParticipants = [];
    for (const participant of participants) {
      const agent = await this.options.agents.resolvePublished(
        participant.agentVersionId,
        owner,
        { resolveExtensions: true },
      );
      if (!agent)
        throw new ProductWorkDefinitionReferenceError(
          participant.role === 'primary'
            ? '$.spec.agent_version_id'
            : participant.role === 'lead'
              ? '$.spec.lead.agent_version_id'
              : `$.spec.members.${resolvedParticipants.length - 1}.agent_version_id`,
          'Referenced Agent version was not found or is not published in this owner scope.',
        );
      resolvedParticipants.push({
        ...participant,
        skills: agent.skills.map((skill) => skill.ref),
        tools: [...agent.toolRefs],
      });
    }
    const environment = await this.options.environments.findVersion(
      owner,
      document.spec.environment_version_id,
    );
    if (!environment || environment.status !== 'published')
      throw new ProductWorkDefinitionReferenceError(
        '$.spec.environment_version_id',
        'Referenced Environment version was not found or is not published in this owner scope.',
      );
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
    return Object.freeze(resolvedParticipants.map((participant) => Object.freeze(participant)));
  }

  private async materializeComposition(input: {
    readonly document: ProductWorkDefinitionDocument;
    readonly owner: WorkDefinitionSourceOwner;
    readonly definitionId: string;
    readonly versionId: string;
    readonly authorFingerprint: string;
  }): Promise<WorkDefinitionCompositionSource> {
    const common = {
      environmentVersionId: input.document.spec.environment_version_id,
      memoryVersionIds: Object.freeze([...input.document.spec.memory_version_ids]),
      description: input.document.metadata.description ?? null,
      inputSchema: input.document.spec.input_schema,
    };
    if (input.document.spec.kind === 'single_agent')
      return Object.freeze({
        kind: 'single_agent' as const,
        agentVersionId: input.document.spec.agent_version_id,
        ...common,
      });

    const teamVersionId = await this.materializeInternalTeam(input);
    return Object.freeze({
      kind: 'collaboration' as const,
      teamVersionId,
      ...common,
    });
  }

  private async materializeInternalTeam(input: {
    readonly document: Extract<ProductWorkDefinitionDocument, { spec: { kind: 'collaboration' } }> | ProductWorkDefinitionDocument;
    readonly owner: WorkDefinitionSourceOwner;
    readonly definitionId: string;
    readonly versionId: string;
    readonly authorFingerprint: string;
  }): Promise<string> {
    if (input.document.spec.kind !== 'collaboration')
      throw new Error('Internal Team materialization requires collaboration source.');
    const teamDefinitionId = stableUuid(`work-definition-team\0${input.definitionId}`);
    const teamVersionId = stableUuid(`work-definition-team-version\0${input.versionId}`);
    const existing = await this.options.invokables.findTeamVersionById(teamVersionId);
    const spec: TeamSpec = {
      lead: {
        name: input.document.spec.lead.name,
        agentVersionId: input.document.spec.lead.agent_version_id,
      },
      roster: input.document.spec.members.map((member) => ({
        name: member.name,
        agentVersionId: member.agent_version_id,
      })),
      environmentVersionId: input.document.spec.environment_version_id,
    };
    if (existing) {
      assertInternalTeam(existing, input.owner, teamDefinitionId, spec);
      if (existing.status === 'published') return existing.id;
    }

    const clock = () => this.now();
    const definition = createTeamDefinition({
      ...input.owner,
      id: teamDefinitionId,
      name: `work-${input.document.metadata.name}`,
      description: 'Internal execution binding for Product Work Definition.',
      now: clock,
    });
    const draft = createDraftTeamVersion({
      ...input.owner,
      id: teamVersionId,
      definitionId: teamDefinitionId,
      name: input.document.metadata.name,
      description: input.document.metadata.description ?? null,
      spec,
      now: clock,
    });
    const importKey = `product-work-team-import:${input.definitionId}:${input.authorFingerprint}`;
    const imported = this.options.invokables.importTeamVersionAtomically
      ? await this.options.invokables.importTeamVersionAtomically({
          definition,
          version: draft,
          idempotencyKey: importKey,
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
  public constructor(public readonly diagnostics: readonly WorkDefinitionDiagnostic[]) {
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
    super('The Idempotency-Key cannot be reused with a different Work Definition source.');
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

function ownerFromAccessContext(access: AccessContext): WorkDefinitionSourceOwner {
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
  const hex = createHash('sha256').update(seed, 'utf8').digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
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
