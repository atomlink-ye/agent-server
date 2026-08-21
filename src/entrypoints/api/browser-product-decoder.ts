import { type ZodType } from 'zod';

export type ProductDecodeResult =
  | { readonly success: true; readonly data: unknown }
  | { readonly success: false };

/**
 * Shared consumer decoder used by the BFF and compatibility probes.
 * Unknown additive fields are ignored; known schema failures fail closed.
 */
export function decodeProductResponse(
  value: unknown,
  schema: ZodType<unknown>,
): ProductDecodeResult {
  const result = schema.safeParse(stripUnknownFields(value, schema));
  return result.success
    ? { success: true, data: result.data }
    : { success: false };
}

function stripUnknownFields(value: unknown, schema: ZodType<unknown>): unknown {
  if (value === null || typeof value !== 'object') return value;

  const definition = schemaDefinition(schema);
  switch (definition?.type) {
    case 'object': {
      if (Array.isArray(value)) return value;
      const shape = definition.shape as Record<string, ZodType<unknown>>;
      const output: Record<string, unknown> = {};
      for (const key of Object.keys(shape)) {
        if (key in value)
          output[key] = stripUnknownFields(
            (value as Record<string, unknown>)[key],
            shape[key]!,
          );
      }
      return output;
    }
    case 'array':
      return Array.isArray(value) && definition.element
        ? value.map((item) => stripUnknownFields(item, definition.element!))
        : value;
    case 'tuple':
      return Array.isArray(value)
        ? value.map((item, index) => {
            const itemSchema = definition.items?.[index];
            return itemSchema ? stripUnknownFields(item, itemSchema) : item;
          })
        : value;
    case 'union': {
      const option = chooseUnionOption(value, definition);
      return option ? stripUnknownFields(value, option) : value;
    }
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'catch':
      return definition.innerType
        ? stripUnknownFields(value, definition.innerType)
        : value;
    case 'intersection': {
      // Both sides describe the SAME value, so each must strip against the
      // original input and the surviving keys are merged. Chaining the two
      // strips would let the left side delete every key the right side owns.
      if (!definition.left || !definition.right) return value;
      const left = stripUnknownFields(value, definition.left);
      const right = stripUnknownFields(value, definition.right);
      return isRecord(left) && isRecord(right) ? { ...left, ...right } : value;
    }
    default:
      return value;
  }
}

function chooseUnionOption(
  value: unknown,
  definition: SchemaDefinition,
): ZodType<unknown> | undefined {
  const options = definition.options as ZodType<unknown>[];
  if (!isRecord(value)) return options[0];

  const discriminator = definition.discriminator;
  if (typeof discriminator === 'string') {
    const matching = options.find((option) => {
      const shape = objectShape(option);
      return shape
        ? literalOrEnumContains(shape[discriminator], value[discriminator])
        : false;
    });
    if (matching) return matching;
  }

  return [...options].sort(
    (left, right) => knownKeyScore(right, value) - knownKeyScore(left, value),
  )[0];
}

function knownKeyScore(
  schema: ZodType<unknown>,
  value: Record<string, unknown>,
) {
  const shape = objectShape(schema);
  return shape ? Object.keys(value).filter((key) => key in shape).length : 0;
}

function literalOrEnumContains(
  schema: ZodType<unknown> | undefined,
  value: unknown,
) {
  const definition = schemaDefinition(schema);
  if (definition?.type === 'literal')
    return (definition.values as unknown[]).includes(value);
  if (definition?.type === 'enum')
    return Object.values(
      definition.entries as Record<string, unknown>,
    ).includes(value);
  return false;
}

function objectShape(
  schema: ZodType<unknown>,
): Record<string, ZodType<unknown>> | undefined {
  const definition = schemaDefinition(schema);
  return definition?.type === 'object'
    ? (definition.shape as Record<string, ZodType<unknown>>)
    : undefined;
}

type SchemaDefinition = {
  readonly type?: string;
  readonly shape?: unknown;
  readonly element?: ZodType<unknown>;
  readonly items?: ZodType<unknown>[];
  readonly options?: ZodType<unknown>[];
  readonly discriminator?: unknown;
  readonly innerType?: ZodType<unknown>;
  readonly left?: ZodType<unknown>;
  readonly right?: ZodType<unknown>;
  readonly values?: unknown[];
  readonly entries?: Record<string, unknown>;
};

function schemaDefinition(
  schema: ZodType<unknown> | undefined,
): SchemaDefinition | undefined {
  if (!schema || typeof schema !== 'object') return undefined;
  return (schema as unknown as { _zod?: { def?: SchemaDefinition } })._zod?.def;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
