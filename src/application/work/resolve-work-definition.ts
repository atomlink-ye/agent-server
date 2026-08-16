import { createHash } from 'node:crypto';

import type { AgentRegistry } from '../ports/agent-registry.js';
import type { AgentResolutionApi } from '../ports/agent-resolution-api.js';
import type { DefinitionReadApi } from '../ports/definition-read-api.js';
import type { EnvironmentReadApi } from '../ports/environment-read-api.js';
import type { MemoryVersionReadApi } from '../ports/memory-version-read-api.js';
import type { WorkDefinitionSourceRepository } from '../ports/work-definition-source-repository.js';
import type {
  ResolveWorkDefinitionInput,
  WorkDefinitionResolutionPort,
} from '../ports/work-definition-resolution.js';
import { AGENT_SERVER_COLLABORATION_TOOL_REFS } from '../../domain/collaboration/canonical-collaboration-tools.js';
import { canonicalizeProjectValue } from '../../domain/projects/project-canonicalization.js';
import {
  WorkCompositionResolutionError,
  fingerprintResolvedWorkDefinition,
  type ResolvedMemoryRef,
  type ResolvedSkillRef,
  type ResolvedWorkDefinition,
  type ResolvedWorkParticipant,
  type WorkPlatformCapability,
} from '../../domain/work/work-composition.js';
import type {
  WorkDefinitionCompositionSource,
  WorkDefinitionSourceDefinition,
  WorkDefinitionSourceVersion,
} from '../../domain/work/work-definition-source.js';

export interface ResolveWorkDefinitionOptions {
  readonly agents: Pick<AgentRegistry, 'findDefinition' | 'findVersion'>;
  readonly agentResolution: AgentResolutionApi;
  readonly definitions: Pick<
    DefinitionReadApi,
    'findTeamDefinitionById' | 'findPublishedTeamVersionById'
  >;
  readonly environments: EnvironmentReadApi;
  readonly authoredDefinitions?: Pick<
    WorkDefinitionSourceRepository,
    'findDefinition' | 'findPublishedVersion'
  >;
  readonly memories?: MemoryVersionReadApi;
}

/**
 * Deterministic and side-effect-free compiler from immutable author intent to
 * the internal execution IR. Existing Agent/Team ids remain accepted as a
 * compatibility source while the authored Work Definition source is the
 * composition-first path used by new product/API surfaces.
 */
export class ResolveWorkDefinition implements WorkDefinitionResolutionPort {
  public constructor(private readonly options: ResolveWorkDefinitionOptions) {}

  public async resolve(
    input: ResolveWorkDefinitionInput,
  ): Promise<ResolvedWorkDefinition> {
    const authored = await this.resolveAuthored(input);
    if (authored) return authored;
    const collaboration = await this.resolveCollaboration(input);
    if (collaboration) return collaboration;
    const single = await this.resolveSingleAgentCompatibility(input);
    if (single) return single;
    throw new WorkCompositionResolutionError(
      'The Work Definition or immutable published version does not exist in this owner scope.',
      '$.definition_version_id',
    );
  }

  private async resolveAuthored(
    input: ResolveWorkDefinitionInput,
  ): Promise<ResolvedWorkDefinition | null> {
    const repository = this.options.authoredDefinitions;
    if (!repository) return null;
    const owner = definitionSourceOwner(input);
    const [definition, version] = await Promise.all([
      repository.findDefinition(input.definitionId, owner),
      repository.findPublishedVersion(input.definitionVersionId, owner),
    ]);
    if (!definition && !version) return null;
    if (!definition || !version || version.definitionId !== definition.id)
      throw new WorkCompositionResolutionError(
        'The authored Work Definition lineage is invalid.',
        '$.definition_version_id',
      );
    return this.compileAuthored(input, definition, version);
  }

  private async compileAuthored(
    input: ResolveWorkDefinitionInput,
    definition: WorkDefinitionSourceDefinition,
    version: WorkDefinitionSourceVersion,
  ): Promise<ResolvedWorkDefinition> {
    const memories = await this.resolveMemories(
      input,
      version.source.memoryVersionIds,
    );
    if (version.source.kind === 'single_agent') {
      const environment = await this.resolveEnvironment(
        input,
        version.source.environmentVersionId,
        '$.resources.environment',
      );
      const participant = await this.resolveParticipant(input, {
        logicalName: definition.name,
        role: 'primary',
        agentVersionId: version.source.agentVersionId,
        diagnosticPath: '$.participants.primary',
      });
      const needsPlatformMcp =
        participant.toolRefs.length > 0 || participant.skills.length > 0;
      const platformCapabilities = Object.freeze(
        needsPlatformMcp
          ? (['platform_mcp'] satisfies WorkPlatformCapability[])
          : ([] satisfies WorkPlatformCapability[]),
      );
      const base = {
        definitionId: definition.id,
        definitionVersionId: version.id,
        kind: 'single_agent' as const,
        name: definition.name,
        description: definition.description,
        sourceFingerprint: version.fingerprint,
        participants: Object.freeze([participant]),
        environment,
        memories,
        platformCapabilities,
        executionPolicy: Object.freeze({
          invokable: Object.freeze({
            kind: 'agent' as const,
            versionId: version.source.agentVersionId,
          }),
          runtimeSessionPolicy: 'fresh' as const,
          runtimeWorkspacePolicy: 'run_scoped' as const,
          requiredRuntimeCapabilities: Object.freeze([
            'external_workspace' as const,
            ...(needsPlatformMcp ? (['platform_mcp'] as const) : []),
          ]),
        }),
      };
      return deepFreeze({
        ...base,
        resolvedFingerprint: fingerprintResolvedWorkDefinition(base),
      });
    }

    return this.compileAuthoredCollaboration(
      input,
      definition,
      version,
      memories,
    );
  }

  private async compileAuthoredCollaboration(
    input: ResolveWorkDefinitionInput,
    definition: WorkDefinitionSourceDefinition,
    version: WorkDefinitionSourceVersion & {
      readonly source: Extract<
        WorkDefinitionCompositionSource,
        { readonly kind: 'collaboration' }
      >;
    },
    memories: readonly ResolvedMemoryRef[],
  ): Promise<ResolvedWorkDefinition> {
    const team = await this.options.definitions.findPublishedTeamVersionById(
      version.source.teamVersionId,
      invokableOwner(input),
    );
    if (!team)
      throw new WorkCompositionResolutionError(
        'The authored collaborative Work references an unavailable published Team version.',
        '$.resources.team_version_id',
      );
    if (team.environmentVersionId !== version.source.environmentVersionId)
      throw new WorkCompositionResolutionError(
        'The Work Definition Environment must match the published Team Environment.',
        '$.resources.environment',
      );
    const environment = await this.resolveEnvironment(
      input,
      version.source.environmentVersionId,
      '$.resources.environment',
    );
    const participants: ResolvedWorkParticipant[] = [
      await this.resolveParticipant(input, {
        logicalName: team.spec.lead.name,
        role: 'lead',
        agentVersionId: team.spec.lead.agentVersionId,
        diagnosticPath: '$.participants.lead',
      }),
    ];
    for (const [index, member] of team.spec.roster.entries()) {
      participants.push(
        await this.resolveParticipant(input, {
          logicalName: member.name,
          role: 'member',
          agentVersionId: member.agentVersionId,
          diagnosticPath: `$.participants.members[${index}]`,
        }),
      );
    }
    const base = {
      definitionId: definition.id,
      definitionVersionId: version.id,
      kind: 'collaboration' as const,
      name: definition.name,
      description: definition.description,
      sourceFingerprint: version.fingerprint,
      participants: Object.freeze(participants),
      environment,
      memories,
      platformCapabilities: Object.freeze([
        'collaboration',
        'platform_mcp',
      ] satisfies readonly WorkPlatformCapability[]),
      executionPolicy: Object.freeze({
        invokable: Object.freeze({ kind: 'team' as const, versionId: team.id }),
        runtimeSessionPolicy: 'reusable' as const,
        runtimeWorkspacePolicy: 'work_run_scoped' as const,
        requiredRuntimeCapabilities: Object.freeze([
          'reusable_session' as const,
          'external_workspace' as const,
          'platform_mcp' as const,
        ]),
      }),
    };
    return deepFreeze({
      ...base,
      resolvedFingerprint: fingerprintResolvedWorkDefinition(base),
    });
  }

  private async resolveCollaboration(
    input: ResolveWorkDefinitionInput,
  ): Promise<ResolvedWorkDefinition | null> {
    const ownerScope = invokableOwner(input);
    const [definition, version] = await Promise.all([
      this.options.definitions.findTeamDefinitionById(input.definitionId),
      this.options.definitions.findPublishedTeamVersionById(
        input.definitionVersionId,
        ownerScope,
      ),
    ]);
    if (!definition && !version) return null;
    if (!definition || !version || version.definitionId !== input.definitionId)
      throw new WorkCompositionResolutionError(
        'The collaborative Work Definition lineage is invalid.',
        '$.definition_version_id',
      );
    if (
      !sameInvokableOwner(definition, ownerScope) ||
      !sameInvokableOwner(version, ownerScope)
    )
      throw new WorkCompositionResolutionError(
        'The collaborative Work Definition belongs to another owner scope.',
        '$.definition_id',
      );
    if (version.status !== 'published')
      throw new WorkCompositionResolutionError(
        'The collaborative Work Definition version is not published.',
        '$.definition_version_id',
      );

    const environment = await this.resolveEnvironment(
      input,
      version.environmentVersionId,
      '$.resources.environment',
    );
    const participants: ResolvedWorkParticipant[] = [
      await this.resolveParticipant(input, {
        logicalName: version.spec.lead.name,
        role: 'lead',
        agentVersionId: version.spec.lead.agentVersionId,
        diagnosticPath: '$.participants.lead',
      }),
    ];
    for (const [index, member] of version.spec.roster.entries()) {
      participants.push(
        await this.resolveParticipant(input, {
          logicalName: member.name,
          role: 'member',
          agentVersionId: member.agentVersionId,
          diagnosticPath: `$.participants.members[${index}]`,
        }),
      );
    }

    const sourceFingerprint = fingerprintSource({
      kind: 'collaboration',
      definition: {
        id: definition.id,
        name: definition.name,
        description: definition.description,
      },
      version: {
        id: version.id,
        definitionId: version.definitionId,
        spec: version.spec,
        publishedAt: version.publishedAt,
      },
    });
    const base = {
      definitionId: definition.id,
      definitionVersionId: version.id,
      kind: 'collaboration' as const,
      name: version.name,
      description: version.description,
      sourceFingerprint,
      participants: Object.freeze(participants),
      environment,
      memories: Object.freeze([]),
      platformCapabilities: Object.freeze([
        'collaboration',
        'platform_mcp',
      ] satisfies readonly WorkPlatformCapability[]),
      executionPolicy: Object.freeze({
        invokable: Object.freeze({ kind: 'team' as const, versionId: version.id }),
        runtimeSessionPolicy: 'reusable' as const,
        runtimeWorkspacePolicy: 'work_run_scoped' as const,
        requiredRuntimeCapabilities: Object.freeze([
          'reusable_session' as const,
          'external_workspace' as const,
          'platform_mcp' as const,
        ]),
      }),
    };
    return deepFreeze({
      ...base,
      resolvedFingerprint: fingerprintResolvedWorkDefinition(base),
    });
  }

  /**
   * Compatibility path for old Product Work rows that pointed directly at a
   * ManagedAgent version before authored Work Definition sources existed.
   * It intentionally has no Environment binding; new Product/API surfaces should
   * publish a Work Definition source instead.
   */
  private async resolveSingleAgentCompatibility(
    input: ResolveWorkDefinitionInput,
  ): Promise<ResolvedWorkDefinition | null> {
    const owner = managedOwner(input);
    const [definition, version] = await Promise.all([
      this.options.agents.findDefinition(owner, input.definitionId),
      this.options.agents.findVersion(owner, input.definitionVersionId),
    ]);
    if (!definition && !version) return null;
    if (!definition || !version || version.definitionId !== input.definitionId)
      throw new WorkCompositionResolutionError(
        'The single-Agent Work Definition lineage is invalid.',
        '$.definition_version_id',
      );
    if (version.status !== 'published')
      throw new WorkCompositionResolutionError(
        'The single-Agent Work Definition version is not published.',
        '$.definition_version_id',
      );

    const participant = await this.resolveParticipant(input, {
      logicalName: version.displayName,
      role: 'primary',
      agentVersionId: version.id,
      diagnosticPath: '$.participants.primary',
    });
    const needsPlatformMcp =
      participant.toolRefs.length > 0 || participant.skills.length > 0;
    const base = {
      definitionId: definition.id,
      definitionVersionId: version.id,
      kind: 'single_agent' as const,
      name: version.displayName,
      description: version.package.spec.description || null,
      sourceFingerprint: version.fingerprint,
      participants: Object.freeze([participant]),
      environment: null,
      memories: Object.freeze([]),
      platformCapabilities: Object.freeze(
        needsPlatformMcp
          ? (['platform_mcp'] satisfies WorkPlatformCapability[])
          : ([] satisfies WorkPlatformCapability[]),
      ),
      executionPolicy: Object.freeze({
        invokable: Object.freeze({ kind: 'agent' as const, versionId: version.id }),
        runtimeSessionPolicy: 'fresh' as const,
        runtimeWorkspacePolicy: 'run_scoped' as const,
        requiredRuntimeCapabilities: Object.freeze(
          needsPlatformMcp ? (['platform_mcp'] as const) : ([] as const),
        ),
      }),
    };
    return deepFreeze({
      ...base,
      resolvedFingerprint: fingerprintResolvedWorkDefinition(base),
    });
  }

  private async resolveEnvironment(
    input: ResolveWorkDefinitionInput,
    versionId: string,
    path: string,
  ) {
    const environment = await this.options.environments.findVersion(
      managedOwner(input),
      versionId,
    );
    if (!environment || environment.status !== 'published')
      throw new WorkCompositionResolutionError(
        'The Work references an unavailable published Environment version.',
        path,
      );
    return Object.freeze({
      versionId: environment.id,
      fingerprint: environment.fingerprint,
    });
  }

  private async resolveMemories(
    input: ResolveWorkDefinitionInput,
    versionIds: readonly string[],
  ): Promise<readonly ResolvedMemoryRef[]> {
    if (versionIds.length === 0) return Object.freeze([]);
    if (!this.options.memories)
      throw new WorkCompositionResolutionError(
        'Work Memory resolution is unavailable.',
        '$.resources.memories',
      );
    const memories: ResolvedMemoryRef[] = [];
    for (const [index, versionId] of versionIds.entries()) {
      const memory = await this.options.memories.findVersion(
        versionId,
        invokableOwner(input),
      );
      if (!memory)
        throw new WorkCompositionResolutionError(
          'The Work references an unavailable immutable Memory version.',
          `$.resources.memories[${index}]`,
        );
      memories.push(
        Object.freeze({
          logicalName: memory.path,
          versionId: memory.versionId,
          fingerprint: `sha256:${memory.contentSha256}`,
        }),
      );
    }
    return Object.freeze(memories);
  }

  private async resolveParticipant(
    input: ResolveWorkDefinitionInput,
    participant: Pick<
      ResolvedWorkParticipant,
      'logicalName' | 'role' | 'agentVersionId'
    > & { readonly diagnosticPath: string },
  ): Promise<ResolvedWorkParticipant> {
    const resolved = await this.options.agentResolution.resolvePublished(
      participant.agentVersionId,
      invokableOwner(input),
      { resolveExtensions: true },
    );
    if (!resolved)
      throw new WorkCompositionResolutionError(
        `Participant ${participant.logicalName} references an unavailable published Agent version.`,
        `${participant.diagnosticPath}.agent_version_id`,
      );

    const collaborationRefs = new Set<string>(
      Object.values(AGENT_SERVER_COLLABORATION_TOOL_REFS),
    );
    for (const ref of resolved.toolRefs) {
      if (collaborationRefs.has(ref))
        throw new WorkCompositionResolutionError(
          'Platform Collaboration tools cannot be declared as user/domain resources.',
          `${participant.diagnosticPath}.tools`,
        );
    }

    const managed = await this.options.agents.findVersion(
      managedOwner(input),
      participant.agentVersionId,
    );
    if (managed && managed.status !== 'published')
      throw new WorkCompositionResolutionError(
        'The participant Agent version is not published.',
        `${participant.diagnosticPath}.agent_version_id`,
      );

    const skills: ResolvedSkillRef[] = resolved.skills.map((skill) => ({
      ref: skill.ref,
      digest: skill.digest,
      requiredToolRefs: Object.freeze([...skill.requiredToolRefs]),
    }));
    return deepFreeze({
      logicalName: participant.logicalName,
      role: participant.role,
      agentVersionId: participant.agentVersionId,
      agentFingerprint: managed?.fingerprint ?? null,
      toolRefs: Object.freeze([...resolved.toolRefs]),
      skills: Object.freeze(skills),
    });
  }
}

function managedOwner(input: ResolveWorkDefinitionInput) {
  return {
    tenantId: input.accessContext.tenantId,
    principalType: input.accessContext.principalType,
    principalId: input.accessContext.principalId,
  };
}

function invokableOwner(input: ResolveWorkDefinitionInput) {
  return {
    tenantId: input.accessContext.tenantId,
    workspaceId: input.accessContext.workspaceId,
    principalType: input.accessContext.principalType,
    principalId: input.accessContext.principalId,
  };
}

function definitionSourceOwner(input: ResolveWorkDefinitionInput) {
  return invokableOwner(input);
}

function sameInvokableOwner(
  value: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly principalType: string;
    readonly principalId: string;
  },
  owner: ReturnType<typeof invokableOwner>,
): boolean {
  return (
    value.tenantId === owner.tenantId &&
    value.workspaceId === owner.workspaceId &&
    value.principalType === owner.principalType &&
    value.principalId === owner.principalId
  );
}

function fingerprintSource(value: unknown): string {
  return `sha256:${createHash('sha256')
    .update(canonicalizeProjectValue(value), 'utf8')
    .digest('hex')}`;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}
