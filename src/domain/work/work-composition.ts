import { createHash } from 'node:crypto';

import { canonicalizeProjectValue } from '../projects/project-canonicalization.js';
import type { ResolvedResourceManifestEntry } from './resolved-resource-manifest.js';
import type { WorkInputSchema } from './work-input-schema.js';

export type WorkCompositionKind = 'single_agent' | 'collaboration';
export type WorkParticipantRole = 'primary' | 'lead' | 'member';
export type WorkPlatformCapability = 'collaboration' | 'platform_mcp';
export type RequiredRuntimeCapability =
  'reusable_session' | 'external_workspace' | 'platform_mcp';

export interface ResolvedSkillRef {
  readonly ref: string;
  readonly digest: string;
  readonly requiredToolRefs: readonly string[];
}

export interface ResolvedMemoryRef {
  readonly logicalName: string;
  readonly versionId: string;
  readonly fingerprint: string | null;
}

export interface ResolvedWorkParticipant {
  readonly logicalName: string;
  readonly role: WorkParticipantRole;
  readonly agentVersionId: string;
  readonly agentFingerprint: string | null;
  readonly toolRefs: readonly string[];
  readonly skills: readonly ResolvedSkillRef[];
}

export interface ResolvedEnvironmentRef {
  readonly versionId: string;
  readonly fingerprint: string;
}

export interface ResolvedWorkExecutionPolicy {
  readonly invokable: {
    readonly kind: 'agent' | 'team';
    readonly versionId: string;
  };
  readonly requiredRuntimeCapabilities: readonly RequiredRuntimeCapability[];
}

/**
 * Immutable internal IR between author intent and technical Task admission.
 * It deliberately references published/versioned resources only; platform
 * capabilities are represented separately from user/domain tool references.
 */
export interface ResolvedWorkDefinition {
  readonly definitionId: string;
  readonly definitionVersionId: string;
  readonly kind: WorkCompositionKind;
  readonly name: string;
  readonly description: string | null;
  readonly sourceFingerprint: string;
  readonly resolvedFingerprint: string;
  /** Present for Product-authored Work Definitions. Legacy compatibility rows may omit it. */
  readonly inputSchema?: WorkInputSchema;
  readonly participants: readonly ResolvedWorkParticipant[];
  readonly environment: ResolvedEnvironmentRef | null;
  readonly memories: readonly ResolvedMemoryRef[];
  readonly platformCapabilities: readonly WorkPlatformCapability[];
  readonly executionPolicy: ResolvedWorkExecutionPolicy;
}

export class WorkCompositionResolutionError extends Error {
  public readonly code = 'invalid_work_composition';

  public constructor(
    message = 'The Work Definition could not be resolved to one immutable composition.',
    public readonly diagnosticPath = '$',
  ) {
    super(message);
    this.name = 'WorkCompositionResolutionError';
  }
}

export function fingerprintResolvedWorkDefinition(
  input: Omit<ResolvedWorkDefinition, 'resolvedFingerprint'>,
): string {
  const canonical = canonicalizeProjectValue(input);
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

export function manifestEntriesForResolvedWorkDefinition(
  definition: ResolvedWorkDefinition,
  resolvedAt: string,
): readonly ResolvedResourceManifestEntry[] {
  const entries: ResolvedResourceManifestEntry[] = [
    {
      slot: 'definition',
      resourceKind: 'definition',
      requestedRef: `${definition.kind}:${definition.definitionVersionId}`,
      resolvedVersionId: definition.definitionVersionId,
      resolvedFingerprint: definition.resolvedFingerprint,
      resolvedAt,
    },
  ];

  for (const participant of definition.participants) {
    const prefix = `participant:${participant.logicalName}`;
    entries.push({
      slot: `${prefix}:agent`,
      resourceKind: 'agent',
      requestedRef: `agent_version:${participant.agentVersionId}`,
      resolvedVersionId: participant.agentVersionId,
      resolvedFingerprint: participant.agentFingerprint,
      resolvedAt,
    });
    for (const skill of participant.skills) {
      entries.push({
        slot: `${prefix}:skill:${skill.ref}`,
        resourceKind: 'skill',
        requestedRef: skill.ref,
        resolvedVersionId: skill.ref,
        resolvedFingerprint: `sha256:${skill.digest}`,
        resolvedAt,
      });
    }
    for (const toolRef of participant.toolRefs) {
      entries.push({
        slot: `${prefix}:tool:${toolRef}`,
        resourceKind: 'tool',
        requestedRef: toolRef,
        resolvedVersionId: toolRef,
        resolvedFingerprint: null,
        resolvedAt,
      });
    }
  }

  if (definition.environment) {
    entries.push({
      slot: 'environment',
      resourceKind: 'environment',
      requestedRef: `environment_version:${definition.environment.versionId}`,
      resolvedVersionId: definition.environment.versionId,
      resolvedFingerprint: definition.environment.fingerprint,
      resolvedAt,
    });
  }

  for (const memory of definition.memories) {
    entries.push({
      slot: `memory:${memory.logicalName}`,
      resourceKind: 'memory',
      requestedRef: `memory_version:${memory.versionId}`,
      resolvedVersionId: memory.versionId,
      resolvedFingerprint: memory.fingerprint,
      resolvedAt,
    });
  }

  for (const capability of definition.platformCapabilities) {
    entries.push({
      slot: `platform:${capability}`,
      resourceKind: 'platform_capability',
      requestedRef: capability,
      resolvedVersionId: capability,
      resolvedFingerprint: null,
      resolvedAt,
    });
  }

  return Object.freeze(entries.map((entry) => Object.freeze(entry)));
}
