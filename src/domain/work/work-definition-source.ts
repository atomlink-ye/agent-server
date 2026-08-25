import { createHash, randomUUID } from 'node:crypto';

import { canonicalizeProjectValue } from '../projects/project-canonicalization.js';
import type { WorkOwnerScope } from './work.js';
import {
  normalizeWorkInputSchema,
  type WorkInputSchema,
} from './work-input-schema.js';

export const MAX_WORK_DEFINITION_MEMORY_REFS = 8;

export interface WorkDefinitionMemorySourceRef {
  readonly versionId: string;
}

type WorkDefinitionSourceCommon = {
  readonly environmentVersionId: string;
  readonly memoryVersionIds: readonly string[];
  /** Version-scoped author metadata. Older internal authored rows may omit it. */
  readonly description?: string | null;
  /** Product-authored definitions pin the run input contract here. */
  readonly inputSchema?: WorkInputSchema;
};

export type WorkDefinitionCompositionSource =
  | (WorkDefinitionSourceCommon & {
      readonly kind: 'single_worker';
      readonly workerVersionId: string;
    })
  | (WorkDefinitionSourceCommon & {
      readonly kind: 'collaboration';
      readonly teamVersionId: string;
    });

export interface WorkDefinitionSourceDefinition {
  readonly id: string;
  readonly owner: WorkOwnerScope & {
    readonly principalType: string;
    readonly principalId: string;
  };
  readonly name: string;
  readonly description: string | null;
  readonly createdAt: string;
}

/**
 * Published source version. Callers that know the composition kind may supply a
 * concrete source type; repository/loader boundaries validate the source before
 * constructing this value.
 */
export interface WorkDefinitionSourceVersion<
  Source extends WorkDefinitionCompositionSource = any,
> {
  readonly id: string;
  readonly definitionId: string;
  readonly owner: WorkDefinitionSourceDefinition['owner'];
  readonly status: 'published';
  readonly source: Source;
  /** Fingerprint of the internal immutable composition source. */
  readonly fingerprint: string;
  readonly createdAt: string;
  readonly publishedAt: string;
}

export class InvalidWorkDefinitionSourceError extends Error {
  public readonly code = 'invalid_work_definition_source';

  public constructor(
    message: string,
    public readonly diagnosticPath = '$',
  ) {
    super(message);
    this.name = 'InvalidWorkDefinitionSourceError';
  }
}

export function validateWorkDefinitionCompositionSource(
  source: WorkDefinitionCompositionSource,
): WorkDefinitionCompositionSource {
  if (source.kind === 'single_worker') {
    assertId(source.workerVersionId, '$.spec.worker_version_id');
  } else if (source.kind === 'collaboration') {
    assertId(source.teamVersionId, '$.spec.team_version_id');
  } else {
    throw new InvalidWorkDefinitionSourceError(
      'Unsupported Work Definition composition kind.',
      '$.spec.kind',
    );
  }
  assertId(source.environmentVersionId, '$.spec.environment_version_id');
  if (
    !Array.isArray(source.memoryVersionIds) ||
    source.memoryVersionIds.length > MAX_WORK_DEFINITION_MEMORY_REFS
  )
    throw new InvalidWorkDefinitionSourceError(
      'The Work Definition has too many Memory version refs.',
      '$.spec.memory_version_ids',
    );
  const seen = new Set<string>();
  source.memoryVersionIds.forEach((id, index) => {
    assertId(id, `$.spec.memory_version_ids[${index}]`);
    if (seen.has(id))
      throw new InvalidWorkDefinitionSourceError(
        'A Memory version may only be referenced once.',
        `$.spec.memory_version_ids[${index}]`,
      );
    seen.add(id);
  });
  if (
    source.description !== undefined &&
    source.description !== null &&
    (typeof source.description !== 'string' ||
      source.description.length > 2_000)
  )
    throw new InvalidWorkDefinitionSourceError(
      'The Work Definition description is invalid.',
      '$.metadata.description',
    );
  let inputSchema: WorkInputSchema | undefined;
  try {
    inputSchema = source.inputSchema
      ? normalizeWorkInputSchema(source.inputSchema)
      : undefined;
  } catch {
    throw new InvalidWorkDefinitionSourceError(
      'The Work Definition input schema is invalid.',
      '$.spec.input_schema',
    );
  }

  const common = {
    environmentVersionId: source.environmentVersionId,
    memoryVersionIds: Object.freeze([...source.memoryVersionIds]),
    ...(source.description === undefined
      ? {}
      : { description: source.description }),
    ...(inputSchema ? { inputSchema } : {}),
  };
  return source.kind === 'single_worker'
    ? Object.freeze({
        kind: 'single_worker' as const,
        workerVersionId: source.workerVersionId,
        ...common,
      })
    : Object.freeze({
        kind: 'collaboration' as const,
        teamVersionId: source.teamVersionId,
        ...common,
      });
}

export function fingerprintWorkDefinitionSource(
  source: WorkDefinitionCompositionSource,
): string {
  const validated = validateWorkDefinitionCompositionSource(source);
  return `sha256:${createHash('sha256')
    .update(canonicalizeProjectValue(validated), 'utf8')
    .digest('hex')}`;
}

export function newWorkDefinitionSourceIdentity(): string {
  return randomUUID();
}

function assertId(value: string, path: string): void {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new InvalidWorkDefinitionSourceError(
      'Work Definition resource refs must use canonical version ids.',
      path,
    );
}
