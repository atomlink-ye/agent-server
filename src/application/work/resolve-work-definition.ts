import type {
  WorkerRegistry,
  WorkerResolutionApi,
} from '../ports/worker-registry.js';
import type { DefinitionReadApi } from '../ports/definition-read-api.js';
import type { EnvironmentReadApi } from '../ports/environment-read-api.js';
import type { MemoryVersionReadApi } from '../ports/memory-version-read-api.js';
import type { WorkDefinitionSourceRepository } from '../ports/work-definition-source-repository.js';
import type {
  ResolveWorkDefinitionInput,
  WorkDefinitionResolutionPort,
} from '../ports/work-definition-resolution.js';
import { AGENT_SERVER_COLLABORATION_TOOL_REFS } from '../../domain/collaboration/canonical-collaboration-tools.js';
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
  /** Formal Worker resolution used by active Product Work sources. */
  readonly workerResolution: WorkerResolutionApi;
  readonly workers: Pick<WorkerRegistry, 'findVersion'>;
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
 * the internal execution IR. Product Work is authored from immutable Worker
 * versions; Coworker Agent resolution is intentionally outside this boundary.
 */
export class ResolveWorkDefinition implements WorkDefinitionResolutionPort {
  public constructor(private readonly options: ResolveWorkDefinitionOptions) {}

  public async resolve(
    input: ResolveWorkDefinitionInput,
  ): Promise<ResolvedWorkDefinition> {
    const authored = await this.resolveAuthored(input);
    if (authored) return authored;
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
    if (version.source.kind === 'single_worker') {
      const environment = await this.resolveEnvironment(
        input,
        version.source.environmentVersionId,
        '$.resources.environment',
      );
      const participant = await this.resolveWorkerParticipant(input, {
        logicalName: definition.name,
        role: 'primary',
        workerVersionId: version.source.workerVersionId,
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
        kind: 'single_worker' as const,
        name: definition.name,
        description: definition.description,
        sourceFingerprint: version.fingerprint,
        participants: Object.freeze([participant]),
        environment,
        memories,
        platformCapabilities,
        executionPolicy: Object.freeze({
          invokable: Object.freeze({
            kind: 'worker' as const,
            versionId: version.source.workerVersionId,
          }),
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
      await this.resolveWorkerParticipant(input, {
        logicalName: team.spec.lead.name,
        role: 'lead',
        workerVersionId: team.spec.lead.workerVersionId,
        diagnosticPath: '$.participants.lead',
      }),
    ];
    for (const [index, member] of team.spec.roster.entries()) {
      participants.push(
        await this.resolveWorkerParticipant(input, {
          logicalName: member.name,
          role: 'member',
          workerVersionId: member.workerVersionId,
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

  private async resolveWorkerParticipant(
    input: ResolveWorkDefinitionInput,
    participant: {
      readonly logicalName: string;
      readonly role: ResolvedWorkParticipant['role'];
      readonly workerVersionId: string;
      readonly diagnosticPath: string;
    },
  ): Promise<ResolvedWorkParticipant> {
    const resolved = await this.options.workerResolution.resolvePublished(
      participant.workerVersionId,
      invokableOwner(input),
      { resolveExtensions: true },
    );
    if (!resolved)
      throw new WorkCompositionResolutionError(
        `Participant ${participant.logicalName} references an unavailable published Worker version.`,
        `${participant.diagnosticPath}.worker_version_id`,
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
    const worker = await this.options.workers.findVersion(
      managedOwner(input),
      participant.workerVersionId,
    );
    if (!worker || worker.status !== 'published')
      throw new WorkCompositionResolutionError(
        'The participant Worker version is not published.',
        `${participant.diagnosticPath}.worker_version_id`,
      );
    const skills: ResolvedSkillRef[] = resolved.skills.map((skill) => ({
      ref: skill.ref,
      digest: skill.digest,
      requiredToolRefs: Object.freeze([...skill.requiredToolRefs]),
    }));
    return deepFreeze({
      logicalName: participant.logicalName,
      role: participant.role,
      workerVersionId: participant.workerVersionId,
      workerFingerprint: worker.fingerprint,
      toolRefs: Object.freeze([...resolved.toolRefs]),
      skills: Object.freeze(skills),
    });
  }
}

function managedOwner(input: ResolveWorkDefinitionInput) {
  return {
    tenantId: input.accessContext.tenantId,
    workspaceId: input.accessContext.workspaceId,
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

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}
