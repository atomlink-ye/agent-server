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
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must use lowercase kebab-case');

const ParticipantNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9 _.-]*$/,
    'must use a stable human-readable participant name',
  );

const InlineSourceSchema = z
  .object({
    source: z
      .string()
      .min(1)
      .max(64 * 1024),
  })
  .strict();

const InputPropertyNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_][A-Za-z0-9_-]*$/, 'must use a stable input property name');

const StringInputPropertySchema = z
  .object({
    type: z.literal('string'),
    min_length: z.number().int().min(0).max(16_384).optional(),
    max_length: z.number().int().min(0).max(16_384).optional(),
    enum: z.array(z.string()).min(1).max(100).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.min_length !== undefined &&
      value.max_length !== undefined &&
      value.min_length > value.max_length
    )
      context.addIssue({
        code: 'custom',
        path: ['max_length'],
        message: 'must be greater than or equal to min_length',
      });
  });

const NumberInputPropertySchema = z
  .object({
    type: z.enum(['number', 'integer']),
    minimum: z.number().finite().optional(),
    maximum: z.number().finite().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.minimum !== undefined &&
      value.maximum !== undefined &&
      value.minimum > value.maximum
    )
      context.addIssue({
        code: 'custom',
        path: ['maximum'],
        message: 'must be greater than or equal to minimum',
      });
  });

const BooleanInputPropertySchema = z
  .object({ type: z.literal('boolean') })
  .strict();

const ProductWorkInputPropertySchema = z.union([
  StringInputPropertySchema,
  NumberInputPropertySchema,
  BooleanInputPropertySchema,
]);

const ProductWorkInputSchemaSchema = z
  .object({
    type: z.literal('object'),
    properties: z
      .record(InputPropertyNameSchema, ProductWorkInputPropertySchema)
      .default({}),
    required: z.array(InputPropertyNameSchema).max(64).default([]),
    additional_properties: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>();
    value.required.forEach((name, index) => {
      if (seen.has(name))
        context.addIssue({
          code: 'custom',
          path: ['required', index],
          message: 'must not contain duplicate input property names',
        });
      seen.add(name);
      if (!(name in value.properties))
        context.addIssue({
          code: 'custom',
          path: ['required', index],
          message: 'must reference a declared property',
        });
    });
  });

const WorkerBindingFields = {
  worker_version_id: CanonicalUuidSchema.optional(),
  worker: InlineSourceSchema.optional(),
};
const EnvironmentBindingFields = {
  environment_version_id: CanonicalUuidSchema.optional(),
  environment: InlineSourceSchema.optional(),
};
const CommonSpecFields = {
  memory_version_ids: z
    .array(CanonicalUuidSchema)
    .max(8)
    .default([])
    .superRefine((ids, ctx) => {
      const seen = new Set<string>();
      ids.forEach((id, i) => {
        if (seen.has(id))
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [i],
            message: 'memory_version_ids must not contain duplicates',
          });
        seen.add(id);
      });
    }),
  input_schema: ProductWorkInputSchemaSchema.default({
    type: 'object',
    properties: {},
    required: [],
    additional_properties: false,
  }),
};

const ParticipantSchema = z
  .object({
    name: ParticipantNameSchema,
    ...WorkerBindingFields,
  })
  .strict()
  .superRefine((value, context) =>
    exactlyOne(
      value.worker_version_id,
      value.worker,
      context,
      'worker_version_id',
      'worker',
    ),
  );

const SingleWorkerSpecSchema = z
  .object({
    kind: z.literal('single_worker'),
    ...WorkerBindingFields,
    ...EnvironmentBindingFields,
    ...CommonSpecFields,
  })
  .strict()
  .superRefine((value, context) => {
    exactlyOne(
      value.worker_version_id,
      value.worker,
      context,
      'worker_version_id',
      'worker',
    );
    exactlyOne(
      value.environment_version_id,
      value.environment,
      context,
      'environment_version_id',
      'environment',
    );
  });

const CollaborationSpecSchema = z
  .object({
    kind: z.literal('collaboration'),
    lead: ParticipantSchema,
    members: z.array(ParticipantSchema).min(1).max(16),
    ...EnvironmentBindingFields,
    ...CommonSpecFields,
  })
  .strict()
  .superRefine((value, context) => {
    exactlyOne(
      value.environment_version_id,
      value.environment,
      context,
      'environment_version_id',
      'environment',
    );
    const seen = new Set([value.lead.name]);
    value.members.forEach((member, index) => {
      if (seen.has(member.name))
        context.addIssue({
          code: 'custom',
          path: ['members', index, 'name'],
          message: 'participant names must be unique',
        });
      seen.add(member.name);
    });
  });

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
    spec: z.union([SingleWorkerSpecSchema, CollaborationSpecSchema]),
  })
  .strict();

export type ProductWorkDefinitionDocument = z.infer<
  typeof ProductWorkDefinitionDocumentSchema
>;
export type ProductWorkInputSchema = z.infer<
  typeof ProductWorkInputSchemaSchema
>;
export type ProductWorkInput = Readonly<Record<string, unknown>>;
export type ProductWorkParticipantBinding = z.infer<typeof ParticipantSchema>;

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
      readonly document: ProductWorkDefinitionDocument;
      readonly diagnostics: readonly [];
    }
  | {
      readonly valid: false;
      readonly diagnostics: readonly WorkDefinitionDiagnostic[];
    };

export type ProductWorkInputValidationResult =
  | {
      readonly valid: true;
      readonly input: ProductWorkInput;
      readonly fingerprint: string;
      readonly diagnostics: readonly [];
    }
  | {
      readonly valid: false;
      readonly diagnostics: readonly WorkDefinitionDiagnostic[];
    };

export function validateProductWorkDefinition(
  source: string,
): ProductWorkDefinitionValidationResult {
  let document: unknown;
  try {
    document = parseYaml(source, { uniqueKeys: true });
  } catch {
    return invalidDefinition(
      '$',
      'invalid_yaml',
      'Work Definition source is not valid YAML.',
    );
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

  const canonical = deepFreeze({
    apiVersion: parsed.data.apiVersion,
    kind: parsed.data.kind,
    metadata: {
      name: parsed.data.metadata.name,
      ...(parsed.data.metadata.description === undefined
        ? {}
        : { description: parsed.data.metadata.description }),
    },
    spec: parsed.data.spec,
  }) as ProductWorkDefinitionDocument;
  return {
    valid: true,
    fingerprint: sha256(canonicalizeProjectValue(canonical)),
    metadata: { normalizedName: parsed.data.metadata.name },
    document: canonical,
    diagnostics: [],
  };
}

export function validateProductWorkRunInput(
  schema: ProductWorkInputSchema,
  value: unknown,
): ProductWorkInputValidationResult {
  if (!isPlainRecord(value))
    return invalidInput(
      '$.input',
      'input_validation_failed',
      'input must be a JSON object.',
    );
  const keys = Object.keys(value);
  if (keys.length > 64)
    return invalidInput(
      '$.input',
      'input_validation_failed',
      'input may contain at most 64 properties.',
    );

  const diagnostics: WorkDefinitionDiagnostic[] = [];
  for (const required of schema.required) {
    if (!(required in value))
      diagnostics.push({
        path: `$.input.${required}`,
        code: 'input_validation_failed',
        message: 'is required',
        severity: 'error',
      });
  }
  for (const [key, candidate] of Object.entries(value)) {
    const property = schema.properties[key];
    if (!property) {
      if (!schema.additional_properties)
        diagnostics.push({
          path: `$.input.${key}`,
          code: 'input_validation_failed',
          message: 'is not declared by the Definition input schema',
          severity: 'error',
        });
      continue;
    }
    validateInputProperty(property, candidate, `$.input.${key}`, diagnostics);
  }
  if (diagnostics.length > 0) return { valid: false, diagnostics };
  const input = deepFreeze({ ...value }) as ProductWorkInput;
  return {
    valid: true,
    input,
    fingerprint: sha256(canonicalizeProjectValue(input)),
    diagnostics: [],
  };
}

export function emptyProductWorkInputSchema(): ProductWorkInputSchema {
  return deepFreeze({
    type: 'object' as const,
    properties: {},
    required: [],
    additional_properties: false,
  }) as ProductWorkInputSchema;
}

function exactlyOne(
  left: unknown,
  right: unknown,
  context: z.RefinementCtx,
  leftKey: string,
  rightKey: string,
): void {
  const count = Number(left !== undefined) + Number(right !== undefined);
  if (count === 1) return;
  context.addIssue({
    code: 'custom',
    path: [leftKey],
    message: `exactly one of ${leftKey} or ${rightKey} is required`,
  });
}

function validateInputProperty(
  property: z.infer<typeof ProductWorkInputPropertySchema>,
  value: unknown,
  path: string,
  diagnostics: WorkDefinitionDiagnostic[],
): void {
  if (property.type === 'string') {
    if (typeof value !== 'string') return pushType('string');
    if (property.min_length !== undefined && value.length < property.min_length)
      diagnostics.push({
        path,
        code: 'input_validation_failed',
        message: `must contain at least ${property.min_length} characters`,
        severity: 'error',
      });
    if (property.max_length !== undefined && value.length > property.max_length)
      diagnostics.push({
        path,
        code: 'input_validation_failed',
        message: `must contain at most ${property.max_length} characters`,
        severity: 'error',
      });
    if (property.enum && !property.enum.includes(value))
      diagnostics.push({
        path,
        code: 'input_validation_failed',
        message: 'must match one of the allowed values',
        severity: 'error',
      });
    return;
  }
  if (property.type === 'boolean') {
    if (typeof value !== 'boolean') pushType('boolean');
    return;
  }
  if (typeof value !== 'number' || !Number.isFinite(value))
    return pushType(property.type);
  if (property.type === 'integer' && !Number.isInteger(value))
    diagnostics.push({
      path,
      code: 'input_validation_failed',
      message: 'must be an integer',
      severity: 'error',
    });
  if (property.minimum !== undefined && value < property.minimum)
    diagnostics.push({
      path,
      code: 'input_validation_failed',
      message: `must be greater than or equal to ${property.minimum}`,
      severity: 'error',
    });
  if (property.maximum !== undefined && value > property.maximum)
    diagnostics.push({
      path,
      code: 'input_validation_failed',
      message: `must be less than or equal to ${property.maximum}`,
      severity: 'error',
    });

  function pushType(expected: string): void {
    diagnostics.push({
      path,
      code: 'input_validation_failed',
      message: `must be a ${expected}`,
      severity: 'error',
    });
  }
}

function invalidDefinition(
  path: string,
  code: string,
  message: string,
): ProductWorkDefinitionValidationResult {
  return {
    valid: false,
    diagnostics: [{ path, code, message, severity: 'error' }],
  };
}

function invalidInput(
  path: string,
  code: string,
  message: string,
): ProductWorkInputValidationResult {
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>))
      deepFreeze(child);
  }
  return value;
}
