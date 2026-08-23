import { createHash, randomUUID } from 'node:crypto';

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
import type { RuntimeToolCatalog } from '../extensions/runtime-tool-catalog.js';

/** The extension owner supplies its opaque desired-state component. */
export interface RuntimeExtensionSetDigest {
  digest(input: {
    readonly agentVersionId: string;
    readonly toolRefs: readonly string[];
  }): string;
}

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
  public constructor(
    private readonly catalog: RuntimeToolCatalog,
    private readonly extensionSet: RuntimeExtensionSetDigest,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public execute(input: ResolveRuntimeSessionSpecInput): RuntimeSessionSpec {
    const configuration = requireConfiguration(input.configuration);
    assertIdentity(input);
    assertConfiguration(configuration);
    for (const toolRef of input.toolRefs) {
      if (!this.catalog.get(toolRef))
        throw new RuntimeSessionSpecResolutionError(`toolRefs:${toolRef}`);
    }
    const toolRefs = Object.freeze(
      input.toolRefs.map((toolRef, index) =>
        requireText(toolRef, `toolRefs[${index}]`),
      ),
    );
    const resolvedSkills = Object.freeze(
      input.resolvedSkills.map((skill, index) => copySkill(skill, index)),
    );
    const extensionSetDigest = requireText(
      this.extensionSet.digest({ agentVersionId: input.agentVersionId, toolRefs }),
      'extensionSetDigest',
    );

    return createRuntimeSessionSpec({
      runtimeSessionId: randomUUID() as RuntimeSessionId,
      revision: runtimeSpecRevision(1),
      workspaceId: input.owner.workspaceId,
      agentVersionId: input.agentVersionId,
      environmentVersionId: input.environmentVersionId,
      resolvedSkills,
      toolRefs,
      provider: configuration.provider,
      model: configuration.model,
      cwd: configuration.cwd,
      systemPromptDigest: digest('system-prompt', input.agentVersionId),
      skillSetDigest: digest(
        'skill-set',
        resolvedSkills.map((skill) => `${skill.ref}:${skill.digest}`).toSorted().join(','),
      ),
      toolCatalogDigest: requireText(this.catalog.digest, 'toolCatalogDigest'),
      extensionSetDigest,
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
  if (
    !Number.isInteger(configuration.contextEpoch) ||
    configuration.contextEpoch < 0
  )
    throw new RuntimeSessionSpecResolutionError('configuration.contextEpoch');
}

function digest(component: string, value: string): string {
  return `sha256:${createHash('sha256').update(`${component}:${value}`, 'utf8').digest('hex')}`;
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
