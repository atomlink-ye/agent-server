export type WorkInputProperty =
  | {
      type: 'string';
      min_length?: number | undefined;
      max_length?: number | undefined;
      enum?: string[] | undefined;
    }
  | {
      type: 'number' | 'integer';
      minimum?: number | undefined;
      maximum?: number | undefined;
    }
  | { type: 'boolean' };

/**
 * Deliberately small MVE schema for Product Work input. It is JSON-Schema-like
 * but is not advertised as complete JSON Schema support. Values returned by the
 * normalizer are frozen at runtime; the structural type stays parser-compatible.
 */
export interface WorkInputSchema {
  type: 'object';
  properties: Record<string, WorkInputProperty>;
  required: string[];
  additional_properties: boolean;
}

export type WorkInputSnapshot = Readonly<Record<string, unknown>>;

export function normalizeWorkInputSchema(
  value: WorkInputSchema,
): WorkInputSchema {
  if (!value || value.type !== 'object' || !isRecord(value.properties))
    throw new Error('Work input schema must describe an object.');
  if (
    !Array.isArray(value.required) ||
    typeof value.additional_properties !== 'boolean'
  )
    throw new Error('Work input schema is invalid.');
  const properties: Record<string, WorkInputProperty> = {};
  for (const [name, property] of Object.entries(value.properties)) {
    if (!/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(name) || !isRecord(property))
      throw new Error('Work input schema property is invalid.');
    const type = property.type;
    if (type === 'string') {
      const min = optionalFiniteInteger(property.min_length);
      const max = optionalFiniteInteger(property.max_length);
      if (min !== undefined && min < 0)
        throw new Error('Work input schema string minimum is invalid.');
      if (max !== undefined && max < 0)
        throw new Error('Work input schema string maximum is invalid.');
      if (min !== undefined && max !== undefined && min > max)
        throw new Error('Work input schema string bounds are invalid.');
      const choices = property.enum;
      if (
        choices !== undefined &&
        (!Array.isArray(choices) ||
          choices.length < 1 ||
          choices.some((item) => typeof item !== 'string'))
      )
        throw new Error('Work input schema string enum is invalid.');
      properties[name] = {
        type,
        ...(min === undefined ? {} : { min_length: min }),
        ...(max === undefined ? {} : { max_length: max }),
        ...(choices === undefined ? {} : { enum: [...choices] }),
      };
      Object.freeze(properties[name]);
      if (properties[name].type === 'string' && properties[name].enum)
        Object.freeze(properties[name].enum);
      continue;
    }
    if (type === 'number' || type === 'integer') {
      const minimum = optionalFiniteNumber(property.minimum);
      const maximum = optionalFiniteNumber(property.maximum);
      if (minimum !== undefined && maximum !== undefined && minimum > maximum)
        throw new Error('Work input schema numeric bounds are invalid.');
      properties[name] = {
        type,
        ...(minimum === undefined ? {} : { minimum }),
        ...(maximum === undefined ? {} : { maximum }),
      };
      Object.freeze(properties[name]);
      continue;
    }
    if (type === 'boolean') {
      properties[name] = { type };
      Object.freeze(properties[name]);
      continue;
    }
    throw new Error('Work input schema property type is unsupported.');
  }
  const required = value.required.map((name) => {
    if (typeof name !== 'string' || !(name in properties))
      throw new Error('Work input schema required property is invalid.');
    return name;
  });
  if (new Set(required).size !== required.length)
    throw new Error('Work input schema required properties must be unique.');
  Object.freeze(properties);
  Object.freeze(required);
  return Object.freeze({
    type: 'object' as const,
    properties,
    required,
    additional_properties: value.additional_properties,
  });
}

export function emptyWorkInputSchema(): WorkInputSchema {
  const properties: Record<string, WorkInputProperty> = {};
  const required: string[] = [];
  Object.freeze(properties);
  Object.freeze(required);
  return Object.freeze({
    type: 'object' as const,
    properties,
    required,
    additional_properties: false,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalFiniteInteger(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    !Number.isFinite(value)
  )
    throw new Error('Work input schema integer bound is invalid.');
  return value;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error('Work input schema numeric bound is invalid.');
  return value;
}
