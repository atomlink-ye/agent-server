import type { RuntimeSessionSpec } from '../../../domain/runtime/runtime-session-spec.js';
import type { RuntimeSpecField } from '../../../domain/runtime/reconciliation-plan.js';

export type { RuntimeSpecField } from '../../../domain/runtime/reconciliation-plan.js';

export interface RuntimeSpecDiff {
  readonly changed: readonly RuntimeSpecField[];
  readonly mutableInPlace: readonly RuntimeSpecField[];
  readonly replacementRequired: readonly RuntimeSpecField[];
}

interface RuntimeSpecComparison {
  readonly field: RuntimeSpecField;
  readonly applied: string | number | null;
  readonly desired: string | number | null;
  readonly mutable: boolean;
}

/**
 * Compares only bootstrap semantics. Runtime identity, revision, timestamps,
 * and resolved arrays are intentionally excluded from the field-level diff.
 */
export function compareRuntimeSpecs(
  applied: RuntimeSessionSpec,
  desired: RuntimeSessionSpec,
): RuntimeSpecDiff {
  if (applied.bootstrapDigest === desired.bootstrapDigest)
    return Object.freeze({
      changed: Object.freeze([] as RuntimeSpecField[]),
      mutableInPlace: Object.freeze([] as RuntimeSpecField[]),
      replacementRequired: Object.freeze([] as RuntimeSpecField[]),
    });

  const comparisons: readonly RuntimeSpecComparison[] = [
    {
      field: 'workspace',
      applied: applied.workspaceId,
      desired: desired.workspaceId,
      mutable: false,
    },
    {
      field: 'agent_version',
      applied: applied.agentVersionId,
      desired: desired.agentVersionId,
      mutable: false,
    },
    {
      field: 'environment_version',
      applied: applied.environmentVersionId,
      desired: desired.environmentVersionId,
      mutable: false,
    },
    {
      field: 'provider',
      applied: applied.provider,
      desired: desired.provider,
      mutable: false,
    },
    {
      field: 'model',
      applied: applied.model,
      desired: desired.model,
      mutable: false,
    },
    {
      field: 'cwd',
      applied: applied.cwd,
      desired: desired.cwd,
      mutable: false,
    },
    {
      field: 'system_prompt',
      applied: applied.systemPromptDigest,
      desired: desired.systemPromptDigest,
      mutable: true,
    },
    {
      field: 'skill_set',
      applied: applied.skillSetDigest,
      desired: desired.skillSetDigest,
      mutable: false,
    },
    {
      field: 'tool_catalog',
      applied: applied.toolCatalogDigest,
      desired: desired.toolCatalogDigest,
      mutable: true,
    },
    {
      field: 'extension_set',
      applied: applied.extensionSetDigest,
      desired: desired.extensionSetDigest,
      mutable: true,
    },
    {
      field: 'context_epoch',
      applied: applied.contextEpoch,
      desired: desired.contextEpoch,
      mutable: true,
    },
  ];

  const changed: RuntimeSpecField[] = [];
  const mutableInPlace: RuntimeSpecField[] = [];
  const replacementRequired: RuntimeSpecField[] = [];

  for (const comparison of comparisons) {
    if (comparison.applied === comparison.desired) continue;

    changed.push(comparison.field);
    if (comparison.mutable) mutableInPlace.push(comparison.field);
    else replacementRequired.push(comparison.field);
  }

  return Object.freeze({
    changed: Object.freeze(changed),
    mutableInPlace: Object.freeze(mutableInPlace),
    replacementRequired: Object.freeze(replacementRequired),
  });
}
