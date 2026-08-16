import { createHash } from 'node:crypto';

import type { AgentRegistry } from '../ports/agent-registry.js';
import type { AgentResolutionApi } from '../ports/agent-resolution-api.js';
import type { DefinitionReadApi } from '../ports/definition-read-api.js';
import type { EnvironmentReadApi } from '../ports/environment-read-api.js';
import type {
  ResolveWorkDefinitionInput,
  WorkDefinitionResolutionPort,
} from '../ports/work-definition-resolution.js';
import { AGENT_SERVER_COLLABORATION_TOOL_REFS } from '../../domain/collaboration/canonical-collaboration-tools.js';
import { canonicalizeProjectValue } from '../../domain/projects/project-canonicalization.js';
import {
  WorkCompositionResolutionError,
  fingerprintResolvedWorkDefinition,
  type ResolvedSkillRef,
  type ResolvedWorkDefinition,
  type ResolvedWorkParticipant,
  type WorkPlatformCapability,
} from '../../domain/work/work-composition.js';

export interface ResolveWorkDefinitionOptions {
  readonly agents: Pick<AgentRegistry, 'findDefinition' | 'findVersion'>;
  readonly agentResolution: AgentResolutionApi;
  readonly definitions: Pick<
    DefinitionReadApi,
    'findTeamDefinitionById' | 'findPublishedTeamVersionById'
  >;
  readonly environments: EnvironmentReadApi;
}

/**
 * Deterministic and side-effect-free compiler from existing published registry
 * resources to one immutable Work composition. Agent/Team/Environment registries
 * remain storage mechanisms behind this boundary.
 */
export class ResolveWorkDefinition implements WorkDefinitionResolutionPort {
  public constructor(private readonly options: ResolveWorkDefinitionOptions) {}

  public async resolve(
    input: ResolveWorkDefinitionInput,
  ): Promise<ResolvedWorkDefinition> {
    const collaboration = await this.resolveCollaboration(input);
    if (collaboration) return collaboration;
    const single = await this.resolveSingleAgent(input);
    if (single) return single;
    throw new WorkCompositionResolutionError(
      'The Work Definition or immutable published version does not exist in this owner scope.',
      '$.definition_version_id',
    );
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
    if (!sameInvokableOwner(definition, ownerScope) || !sameInvokableOwner(version, ownerScope))
      throw new WorkCompositionResolutionError(
        'The collaborative Work Definition belongs to another owner scope.',
        '$.definition_id',
      );
    if (version.status !== 'published')
      throw new WorkCompositionResolutionError(
        'The collaborative Work Definition version is not published.',
        '$.definition_version_id',
      );

    const environment = await this.options.environments.findVersion(
      managedOwner(input),
      version.environmentVersionId,
    );
    if (!environment || environment.status !== 'published')
      throw new WorkCompositionResolutionError(
        'The collaborative Work references an unavailable published Environment version.',
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

    const platformCapabilities = Object.freeze([
      'collaboration',
      'platform_mcp',
    ] satisfies readonly WorkPlatformCapability[]);
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
      environment: Object.freeze({
        versionId: environment.id,
        fingerprint: environment.fingerprint,
      }),
      memories: Object.freeze([]),
      platformCapabilities,
      executionPolicy: Object.freeze({
        invokable: Object.freeze({ kind: 'team' as const, versionId: version.id }),
        runtimeSessionPolicy: 'reusable' as const,
        runtimeWorkspacePolicy: 'work_run_scoped' as const,
        requiredRuntimeCapabilities: Object.freeze([
          'reusable_session',
          'external_workspace',
          'platform_mcp',
        ] as const),
      }),
    };
    return deepFreeze({
      ...base,
      resolvedFingerprint: fingerprintResolvedWorkDefinition(base),
    });
  }

  private async resolveSingleAgent(
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
    const platformCapabilities = Object.freeze(
      needsPlatformMcp
        ? (['platform_mcp'] satisfies WorkPlatformCapability[])
        : ([] satisfies WorkPlatformCapability[]),
    );
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
      platformCapabilities,
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
