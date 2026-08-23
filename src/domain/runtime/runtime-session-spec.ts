import { createHash } from 'node:crypto';

import type {
  RuntimeSessionId,
  RuntimeSpecRevision,
} from './runtime-session.js';

export interface RuntimeResolvedSkill {
  readonly ref: string;
  readonly digest: string;
}

/** Immutable desired execution state for one RuntimeSession revision. */
export interface RuntimeSessionSpec {
  readonly runtimeSessionId: RuntimeSessionId;
  readonly revision: RuntimeSpecRevision;

  readonly workspaceId: string;
  readonly agentVersionId: string;
  readonly environmentVersionId: string | null;
  readonly resolvedSkills: readonly RuntimeResolvedSkill[];
  readonly toolRefs: readonly string[];

  readonly provider: string;
  readonly model: string | null;
  readonly cwd: string;

  readonly systemPromptDigest: string;
  readonly skillSetDigest: string;
  readonly toolCatalogDigest: string;
  readonly extensionSetDigest: string;
  readonly contextEpoch: number;

  readonly bootstrapDigest: string;
  readonly createdAt: string;
}

export type RuntimeSessionSpecInput = Omit<
  RuntimeSessionSpec,
  'bootstrapDigest'
>;

/**
 * Inputs that define desired bootstrap identity. Runtime/provider bindings,
 * endpoint epochs, and authorization leases are deliberately not accepted.
 */
export interface RuntimeBootstrapDigestInput {
  readonly provider: string;
  readonly model: string | null;
  readonly cwd: string;
  readonly workspaceId: string;
  readonly agentVersionId: string;
  readonly environmentVersionId: string | null;
  readonly systemPromptDigest: string;
  readonly skillSetDigest: string;
  readonly toolCatalogDigest: string;
  readonly extensionSetDigest: string;
  readonly contextEpoch: number;
}

/**
 * Computes the stable desired bootstrap digest for a RuntimeSessionSpec.
 *
 * The canonical serializer sorts object keys recursively. Arrays retain their
 * declared order, while this digest input contains only scalar fingerprints.
 */
export function computeRuntimeBootstrapDigest(
  input: RuntimeBootstrapDigestInput,
): string {
  return createHash('sha256')
    .update(
      canonicalizeRuntimeValue({
        provider: input.provider,
        model: input.model,
        cwd: input.cwd,
        workspaceId: input.workspaceId,
        agentVersionId: input.agentVersionId,
        environmentVersionId: input.environmentVersionId,
        systemPromptDigest: input.systemPromptDigest,
        skillSetDigest: input.skillSetDigest,
        toolCatalogDigest: input.toolCatalogDigest,
        extensionSetDigest: input.extensionSetDigest,
        contextEpoch: input.contextEpoch,
      }),
      'utf8',
    )
    .digest('hex');
}

/** Constructs a spec with its digest derived from desired state. */
export function createRuntimeSessionSpec(
  input: RuntimeSessionSpecInput,
): RuntimeSessionSpec {
  return Object.freeze({
    ...input,
    bootstrapDigest: computeRuntimeBootstrapDigest(input),
  });
}

/** Validates a persisted spec before it is used or re-persisted. */
export function assertRuntimeSessionSpec(spec: RuntimeSessionSpec): void {
  const expected = computeRuntimeBootstrapDigest(spec);
  if (spec.bootstrapDigest !== expected)
    throw new Error(
      `Runtime session spec ${spec.runtimeSessionId}:${String(spec.revision)} has an inconsistent bootstrap digest.`,
    );
}

function canonicalizeRuntimeValue(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonicalizeRuntimeValue).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalizeRuntimeValue(record[key])}`,
      )
      .join(',')}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined)
    throw new Error('Runtime bootstrap values must be JSON serializable.');
  return serialized;
}
