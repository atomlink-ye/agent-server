import {
  ManagedPatternError,
  validateManagedPattern,
} from './managed-agent-pattern.js';

export const MAX_SCHEMA_DEPTH = 8;

export type JsonSchema = {
  readonly type:
    'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  readonly required?: readonly string[];
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly items?: JsonSchema;
  readonly enum?: readonly (string | number | boolean)[];
  readonly min?: number;
  readonly max?: number;
  readonly pattern?: string;
  readonly additionalProperties: false;
};

export class ManagedAgentSchemaError extends Error {
  constructor(
    readonly code: string,
    readonly path = '$',
  ) {
    super(code);
  }
}

const fail = (code: string, path?: string): never => {
  throw new ManagedAgentSchemaError(code, path);
};
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const checkKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void => {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    fail('unknown_schema_field', `${path}.__unknown__`);
};

export function validateJsonSchema(
  value: any,
  path = '$.spec.input.schema',
  depth = 0,
): JsonSchema {
  if (!isObject(value) || depth > MAX_SCHEMA_DEPTH)
    fail('invalid_schema', path);
  const type = value.type;
  if (
    !['object', 'string', 'number', 'integer', 'boolean', 'array'].includes(
      String(type),
    )
  )
    fail('invalid_schema', `${path}.type`);

  const common = ['type', 'enum', 'additionalProperties'];
  const allowedByType: Record<string, string[]> = {
    object: [...common, 'required', 'properties'],
    array: [...common, 'items', 'min', 'max'],
    string: [...common, 'min', 'max', 'pattern'],
    number: [...common, 'min', 'max'],
    integer: [...common, 'min', 'max'],
    boolean: common,
  };
  checkKeys(value, allowedByType[String(type)] ?? [], path);
  if (value.additionalProperties !== false)
    fail('invalid_schema', `${path}.additionalProperties`);

  if (
    value.min !== undefined &&
    (typeof value.min !== 'number' || !Number.isFinite(value.min))
  )
    fail('invalid_schema', `${path}.min`);
  if (
    value.max !== undefined &&
    (typeof value.max !== 'number' ||
      !Number.isFinite(value.max) ||
      (value.min !== undefined && value.max < value.min))
  )
    fail('invalid_schema', `${path}.max`);
  if (
    value.enum !== undefined &&
    (!Array.isArray(value.enum) ||
      value.enum.some(
        (item: unknown) =>
          !['string', 'number', 'boolean'].includes(typeof item) ||
          (typeof item === 'number' && !Number.isFinite(item)),
      ))
  )
    fail('invalid_schema', `${path}.enum`);
  if (value.pattern !== undefined) {
    if (typeof value.pattern !== 'string')
      fail('invalid_regex', `${path}.pattern`);
    try {
      validateManagedPattern(value.pattern);
    } catch (error) {
      if (error instanceof ManagedPatternError)
        fail('invalid_regex', `${path}.pattern`);
      throw error;
    }
  }
  if (type === 'object') {
    if (
      value.required !== undefined &&
      (!Array.isArray(value.required) ||
        value.required.some((item: unknown) => typeof item !== 'string'))
    )
      fail('invalid_schema', `${path}.required`);
    if (value.properties !== undefined && !isObject(value.properties))
      fail('invalid_schema', `${path}.properties`);
    const properties = value.properties as Record<string, unknown> | undefined;
    if (properties && Object.keys(properties).length > 64)
      fail('collection_limit', `${path}.properties`);
    if (properties) {
      Object.values(properties).forEach((child, index) =>
        validateJsonSchema(child, `${path}.properties[${index}]`, depth + 1),
      );
      if (
        value.required &&
        value.required.some((name: string) => !(name in properties))
      )
        fail('invalid_schema', `${path}.required`);
    }
  }
  if (type === 'array' && value.items !== undefined)
    validateJsonSchema(value.items, `${path}.items`, depth + 1);
  return value as JsonSchema;
}
