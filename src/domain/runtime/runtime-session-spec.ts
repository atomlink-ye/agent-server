import { createHash } from 'node:crypto';

import type {
  RuntimeSessionId,
  RuntimeSpecRevision,
} from './runtime-session.js';

export interface RuntimeResolvedSkill {
  readonly ref: string;
  readonly digest: string;
}

/**
 * A stable opaque fingerprint supplied by the owner of one desired-state
 * component. Runtime only combines these values; it never defines how a
 * catalog, skill set, prompt, or extension owner derives its own fingerprint.
 */
export type RuntimeDigestComponent = string;

/** Immutable desired execution state for one RuntimeSession revision. */
export interface RuntimeSessionSpec {
  readonly runtimeSessionId: RuntimeSessionId;
  readonly revision: RuntimeSpecRevision;

  readonly workspaceId: string;
  /** Chat identity and Work execution identity share a substrate, never a type. */
  readonly subjectKind: 'agent_chat' | 'worker' | 'legacy_agent_task';
  readonly agentVersionId: string | null;
  readonly workerVersionId: string | null;
  readonly environmentVersionId: string | null;
  readonly resolvedSkills: readonly RuntimeResolvedSkill[];
  readonly toolRefs: readonly string[];

  readonly provider: string;
  readonly model: string | null;
  readonly cwd: string;

  readonly systemPromptDigest: RuntimeDigestComponent;
  readonly skillSetDigest: RuntimeDigestComponent;
  readonly toolCatalogDigest: RuntimeDigestComponent;
  readonly extensionSetDigest: RuntimeDigestComponent;
  readonly contextEpoch: number;

  readonly bootstrapDigest: string;
  readonly createdAt: string;
}

export type RuntimeSessionSpecInput = Omit<
  RuntimeSessionSpec,
  'bootstrapDigest' | 'subjectKind' | 'workerVersionId'
> &
  Partial<Pick<RuntimeSessionSpec, 'subjectKind' | 'workerVersionId'>>;

/**
 * The complete runtime-owned bootstrap-digest contract. Bootstrap identity is
 * the canonical combination of resolved provider/model/cwd and product
 * identity with four owner-provided opaque component fingerprints. The applied
 * digest persisted on a generation is exactly this value for the spec it
 * applied; provider workspace/session bindings, endpoint epochs, grants, and
 * tokens are actual/authorization state and are deliberately excluded.
 */
export interface RuntimeBootstrapDigestInput {
  readonly provider: string;
  readonly model: string | null;
  readonly cwd: string;
  readonly workspaceId: string;
  readonly subjectKind: RuntimeSessionSpec['subjectKind'];
  readonly agentVersionId: string | null;
  readonly workerVersionId: string | null;
  readonly environmentVersionId: string | null;
  readonly systemPromptDigest: RuntimeDigestComponent;
  readonly skillSetDigest: RuntimeDigestComponent;
  readonly toolCatalogDigest: RuntimeDigestComponent;
  readonly extensionSetDigest: RuntimeDigestComponent;
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
        subjectKind: input.subjectKind,
        agentVersionId: input.agentVersionId,
        workerVersionId: input.workerVersionId,
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
  const subjectKind = input.subjectKind ?? 'agent_chat';
  const workerVersionId = input.workerVersionId ?? null;
  return Object.freeze({
    ...input,
    subjectKind,
    workerVersionId,
    bootstrapDigest: computeRuntimeBootstrapDigest({
      ...input,
      subjectKind,
      workerVersionId,
    }),
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
