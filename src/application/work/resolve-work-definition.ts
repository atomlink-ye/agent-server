import type { AgentRegistry } from '../ports/agent-registry.js';
import type { AgentResolutionApi } from '../ports/agent-resolution-api.js';
import type { DefinitionReadApi } from '../ports/definition-read-api.js';
import type { EnvironmentReadApi } from '../ports/environment-read-api.js';
import type {
  ResolveWorkDefinitionInput,
  WorkDefinitionResolutionPort,
} from '../ports/work-definition-resolution.js';
import { AGENT_SERVER_COLLABORATION_TOOL_REFS } from '../agents/built-in-skills.js';
import { canonicalizeProjectValue } from '../../domain/projects/project-canonicalization.js';
import {
  WorkCompositionResolutionError,
  fingerprintResolvedWorkDefinition,
  type ResolvedSkillRef,
  type ResolvedWorkDefinition,
  type ResolvedWorkParticipant,
  type WorkPlatformCapability,
} from '../../domain/work/work-composition.js';
import { createHash } from 'node:crypto';

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
 * Deterministic, side-effect-free compiler from existing registry resources to
 * one immutable Work composition. Team/Agent registries remain implementation
 * details behind this boundary.
 */
export class ResolveWorkDefinition implements WorkDefinitionResolutionPort {
  public constructor(private readonly options: ResolveWorkDefinitionOptions) {}

  public async resolve(
    input: ResolveWorkDefinitionInput,
  ): Promise<ResolvedWorkDefinition> {
    const collaborative = await this.resolveCollaboration(input);
    if (collaborative) return collaborative;
    const single = await this.resolveSingleAgent(input);
    if (single) return single;
    throw new WorkCompositionResolutionError();
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
    if (
      !definition ||
      !version ||
      version.definitionId !== input.definitionId ||
      definition.tenantId !== ownerScope.tenantId ||
      definition.workspaceId !== ownerScope.workspaceId ||
      definition.principalType !== ownerScope.principalType ||
      definition.principalId !== ownerScope.principalId ||
      version.tenantId !== ownerScope.tenantId ||
      version.workspaceId !== ownerScope.workspaceId ||
      version.principalType !== ownerScope.principalType ||
      version.principalId !== ownerScope.principalId ||
      version.status !== 'published'
    )
      throw new WorkCompositionResolutionError();

    const environment = await this.options.environments.findVersion(
      managedOwner(input),
      version.environmentVersionId,
    );
    if (!environment || environment.status !== 'published')
      throw new WorkCompositionResolutionError(
        'The collaborative Work references an unavailable Environment version.',
      );

    const participants: ResolvedWorkParticipant[] = [];
    participants.push(
      await this.resolveParticipant(input, {
        logicalName: version.spec.lead.name,
        role: 'lead',
        agentVersionId: version.spec.lead.agentVersionId,
      }),
    );
    for (const member of version.spec.roster)
      participants.push(
        await this.resolveParticipant(input, {
          logicalName: member.name,
          role: 'member',
          agentVersionId: member.agentVersionId,
        }),
      );

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
    const [definition, managedVersion] = await Promise.all([
      this.options.agents.findDefinition(owner, input.definitionId),
      this.options.agents.findVersion(owner, input.definitionVersionId),
    ]);
    if (!definition && !managedVersion) return null;
    if (
      !definition ||
      !managedVersion ||
      managedVersion.status !== 'published' ||
      managedVersion.definitionId !== input.definitionId
    )
      throw new WorkCompositionResolutionError();

    const participant = await this.resolveParticipant(input, {
      logicalName: managedVersion.displayName,
      role: 'primary',
      agentVersionId: managedVersion.id,
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
      definitionVersionId: managedVersion.id,
      kind: 'single_agent' as const,
      name: managedVersion.displayName,
      description: managedVersion.package.spec.description || null,
      sourceFingerprint: managedVersion.fingerprint,
      participants: Object.freeze([participant]),
      environment: null,
      platformCapabilities,
      executionPolicy: Object.freeze({
        invokable: Object.freeze({
          kind: 'agent' as const,
          versionId: managedVersion.id,
        }),
        // Current root Agent Work is intentionally task/run scoped. A reusable
        // RuntimeSession requires an explicit durable owner and is not inferred
        // from the ManagedAgent package's follow-up binding field.
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
    >,
  ): Promise<ResolvedWorkParticipant> {
    const scope = invokableOwner(input);
    const resolved = await this.options.agentResolution.resolvePublished(
      participant.agentVersionId,
      scope,
      { resolveExtensions: true },
    );
    if (!resolved)
      throw new WorkCompositionResolutionError(
        `The participant ${participant.logicalName} references an unavailable Agent version.`,
      );

    for (const ref of resolved.toolRefs)
      if (
        Object.values(AGENT_SERVER_COLLABORATION_TOOL_REFS).includes(
          ref as (typeof AGENT_SERVER_COLLABORATION_TOOL_REFS)[keyof typeof AGENT_SERVER_COLLABORATION_TOOL_REFS],
        )
      )
        throw new WorkCompositionResolutionError(
          'Platform Collaboration tools cannot be user/domain resources.',
        );

    const managed = await this.options.agents.findVersion(
      managedOwner(input),
      participant.agentVersionId,
    );
    if (managed && managed.status !== 'published')
      throw new WorkCompositionResolutionError();

    const skills: ResolvedSkillRef[] = resolved.skills.map((skill) => ({
      ref: skill.ref,
      digest: skill.digest,
      requiredToolRefs: Object.freeze([...skill.requiredToolRefs]),
    }));
    return deepFreeze({
      ...participant,
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
