import { createHash } from 'node:crypto';

import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { canonicalizeProjectValue } from '../../domain/projects/project-canonicalization.js';

const CanonicalUuidSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    'must be a canonical UUID',
  );

const DefinitionNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'must use lowercase kebab-case',
  );

const CommonSpecShape = {
  environment_version_id: CanonicalUuidSchema,
  memory_version_ids: z.array(CanonicalUuidSchema).max(8).default([]),
};

const ProductWorkDefinitionDocumentSchema = z
  .object({
    apiVersion: z.literal('agentserver.dev/v1alpha1'),
    kind: z.literal('WorkDefinition'),
    metadata: z
      .object({
        name: DefinitionNameSchema,
        description: z.string().trim().max(2_000).optional(),
      })
      .strict(),
    spec: z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('single_agent'),
          agent_version_id: CanonicalUuidSchema,
          ...CommonSpecShape,
        })
        .strict(),
      z
        .object({
          kind: z.literal('collaboration'),
          team_version_id: CanonicalUuidSchema,
          ...CommonSpecShape,
        })
        .strict(),
    ]),
  })
  .strict();

export interface WorkDefinitionDiagnostic {
  readonly path: string;
  readonly code: string;
  readonly message: string;
  readonly severity: 'error';
}

export type ProductWorkDefinitionValidationResult =
  | {
      readonly valid: true;
      readonly fingerprint: string;
      readonly metadata: {
        readonly normalizedName: string;
      };
      readonly diagnostics: readonly [];
    }
  | {
      readonly valid: false;
      readonly diagnostics: readonly WorkDefinitionDiagnostic[];
    };

/**
 * Side-effect-free product authoring boundary. This deliberately validates only
 * the Work Definition document contract. Immutable resource resolution belongs
 * to the later apply/plan slice so validate can be cheap and deterministic.
 */
export function validateProductWorkDefinition(
  source: string,
): ProductWorkDefinitionValidationResult {
  let document: unknown;
  try {
    document = parseYaml(source, { uniqueKeys: true });
  } catch {
    return invalid('$', 'invalid_yaml', 'Work Definition source is not valid YAML.');
  }

  const parsed = ProductWorkDefinitionDocumentSchema.safeParse(document);
  if (!parsed.success) {
    return {
      valid: false,
      diagnostics: parsed.error.issues.map((issue) => ({
        path: toDiagnosticPath(issue.path),
        code: `invalid_${issue.code}`,
        message: issue.message,
        severity: 'error' as const,
      })),
    };
  }

  const canonical = {
    apiVersion: parsed.data.apiVersion,
    kind: parsed.data.kind,
    metadata: {
      name: parsed.data.metadata.name,
      ...(parsed.data.metadata.description === undefined
        ? {}
        : { description: parsed.data.metadata.description }),
    },
    spec: parsed.data.spec,
  };
  return {
    valid: true,
    fingerprint: `sha256:${createHash('sha256')
      .update(canonicalizeProjectValue(canonical), 'utf8')
      .digest('hex')}`,
    metadata: { normalizedName: parsed.data.metadata.name },
    diagnostics: [],
  };
}

function invalid(
  path: string,
  code: string,
  message: string,
): ProductWorkDefinitionValidationResult {
  return {
    valid: false,
    diagnostics: [{ path, code, message, severity: 'error' }],
  };
}

function toDiagnosticPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return '$';
  return path.reduce<string>((result, segment) => {
    if (typeof segment === 'number') return `${result}[${segment}]`;
    const text = String(segment);
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(text)
      ? `${result}.${text}`
      : `${result}[${JSON.stringify(text)}]`;
  }, '$');
}
