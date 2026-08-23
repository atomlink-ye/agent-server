import type { ResolveRuntimeSessionSpec } from '../ports/resolve-runtime-session-spec.js';
import type {
  ResolveRuntimeSessionSpecInput,
  RuntimeSessionSpecConfiguration,
} from '../ports/resolve-runtime-session-spec.js';
import {
  createRuntimeSessionSpec,
  type RuntimeResolvedSkill,
  type RuntimeSessionSpec,
} from '../../domain/runtime/runtime-session-spec.js';
import {
  runtimeSpecRevision,
  type RuntimeSessionId,
} from '../../domain/runtime/runtime-session.js';

/** Raised when an owner did not supply a required desired-state component. */
export class RuntimeSessionSpecResolutionError extends Error {
  public constructor(component: string) {
    super(`Runtime session spec requires ${component}.`);
    this.name = 'RuntimeSessionSpecResolutionError';
  }
}

/**
 * P1-owned assembly point for complete desired RuntimeSession specs.
 *
 * This service deliberately has no process-configured fallback. In particular,
 * provider cwd, model selection, and all digest components must be supplied by
 * their owners for this exact desired revision.
 */
export class ResolveRuntimeSessionSpecService implements ResolveRuntimeSessionSpec {
  public constructor(private readonly now: () => Date = () => new Date()) {}

  public execute(input: ResolveRuntimeSessionSpecInput): RuntimeSessionSpec {
    const configuration = requireConfiguration(input.configuration);
    assertIdentity(input);
    assertConfiguration(configuration);

    return createRuntimeSessionSpec({
      runtimeSessionId: randomUUID() as RuntimeSessionId,
      revision: runtimeSpecRevision(1),
      workspaceId: input.owner.workspaceId,
      agentVersionId: input.agentVersionId,
      environmentVersionId: input.environmentVersionId,
      resolvedSkills: Object.freeze(
        input.resolvedSkills.map((skill, index) => copySkill(skill, index)),
      ),
      toolRefs: Object.freeze(
        input.toolRefs.map((toolRef, index) =>
          requireText(toolRef, `toolRefs[${index}]`),
        ),
      ),
      provider: configuration.provider,
      model: configuration.model,
      cwd: configuration.cwd,
      systemPromptDigest: configuration.systemPromptDigest,
      skillSetDigest: configuration.skillSetDigest,
      toolCatalogDigest: configuration.toolCatalogDigest,
      extensionSetDigest: configuration.extensionSetDigest,
      contextEpoch: configuration.contextEpoch,
      createdAt: this.now().toISOString(),
    });
  }
}

function assertIdentity(input: ResolveRuntimeSessionSpecInput): void {
  requireText(input.owner?.tenantId, 'owner.tenantId');
  requireText(input.owner?.workspaceId, 'owner.workspaceId');
  requireText(input.owner?.principalType, 'owner.principalType');
  requireText(input.owner?.principalId, 'owner.principalId');
  requireText(input.agentVersionId, 'agentVersionId');
  if (input.environmentVersionId !== null)
    requireText(input.environmentVersionId, 'environmentVersionId');
  if (!Array.isArray(input.resolvedSkills))
    throw new RuntimeSessionSpecResolutionError('resolvedSkills');
  if (!Array.isArray(input.toolRefs))
    throw new RuntimeSessionSpecResolutionError('toolRefs');
}

function requireConfiguration(
  configuration: RuntimeSessionSpecConfiguration | null | undefined,
): RuntimeSessionSpecConfiguration {
  if (!configuration)
    throw new RuntimeSessionSpecResolutionError('configuration');
  return configuration;
}

function assertConfiguration(
  configuration: RuntimeSessionSpecConfiguration,
): void {
  requireText(configuration.provider, 'configuration.provider');
  if (configuration.model !== null)
    requireText(configuration.model, 'configuration.model');
  requireText(configuration.cwd, 'configuration.cwd');
  requireText(
    configuration.systemPromptDigest,
    'configuration.systemPromptDigest',
  );
  requireText(configuration.skillSetDigest, 'configuration.skillSetDigest');
  requireText(
    configuration.toolCatalogDigest,
    'configuration.toolCatalogDigest',
  );
  requireText(
    configuration.extensionSetDigest,
    'configuration.extensionSetDigest',
  );
  if (
    !Number.isInteger(configuration.contextEpoch) ||
    configuration.contextEpoch < 0
  )
    throw new RuntimeSessionSpecResolutionError('configuration.contextEpoch');
}

function copySkill(
  skill: RuntimeResolvedSkill,
  index: number,
): RuntimeResolvedSkill {
  return Object.freeze({
    ref: requireText(skill?.ref, `resolvedSkills[${index}].ref`),
    digest: requireText(skill?.digest, `resolvedSkills[${index}].digest`),
  });
}

function requireText(value: unknown, component: string): string {
  if (typeof value !== 'string' || value.trim() === '')
    throw new RuntimeSessionSpecResolutionError(component);
  return value;
}
import { randomUUID } from 'node:crypto';
