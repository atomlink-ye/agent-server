import 'server-only';

import { NextResponse } from 'next/server';
import { type ZodType } from 'zod';

import { getProductApi } from '@/lib/product-api-client';
import { ProductApiClientError } from '@/lib/product-api-client';

import {
  ErrorResponseSchema,
  type ErrorResponse,
  GetWorkResponseSchema,
  ProductRunTraceResponseSchema,
  ProductWorkRunResponseSchema,
  WorkListResponseSchema,
  WorkRunListResponseSchema,
} from '@atomlink-ye/agent-server/product-contract';

export const productResponseHeaders = {
  'cache-control': 'no-store',
} as const;

const upstreamFetchedHeader = 'x-agent-server-upstream';

export async function readProduct(
  path: string,
  schema: ZodType<unknown>,
): Promise<NextResponse> {
  let upstream: Response;
  try {
    upstream = await getProductApi(path);
  } catch (error) {
    return safeFailure(
      error instanceof ProductApiClientError ? error : undefined,
      503,
    );
  }

  const body = await readJson(upstream);
  if (upstream.status >= 200 && upstream.status < 300) {
    const decoded = decodeProduct(body, schema);
    if (!decoded.success) return safeFailure(undefined, 502);
    return NextResponse.json(decoded.data, {
      status: upstream.status,
      headers: {
        ...productResponseHeaders,
        [upstreamFetchedHeader]: 'fetched',
      },
    });
  }

  const decodedError = decodeProduct(body, ErrorResponseSchema);
  if (!decodedError.success) return safeFailure(undefined, 502);
  return NextResponse.json(decodedError.data, {
    status: safeUpstreamStatus(upstream.status),
    headers: productResponseHeaders,
  });
}

export function invalidProductRequest(): NextResponse {
  return safeFailure(undefined, 400, 'invalid_request');
}

export function productSchemaFor(
  route: 'works' | 'work' | 'runs' | 'run' | 'trace',
): ZodType<unknown> {
  switch (route) {
    case 'works':
      return WorkListResponseSchema;
    case 'work':
      return GetWorkResponseSchema;
    case 'runs':
      return WorkRunListResponseSchema;
    case 'run':
      return ProductWorkRunResponseSchema;
    case 'trace':
      return ProductRunTraceResponseSchema;
  }
}

function decodeProduct(
  value: unknown,
  schema: ZodType<unknown>,
): { success: true; data: unknown } | { success: false } {
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
    case 'intersection':
      return definition.left && definition.right
        ? stripUnknownFields(
            stripUnknownFields(value, definition.left),
            definition.right,
          )
        : value;
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

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function safeFailure(
  _error: ProductApiClientError | undefined,
  status: number,
  code = 'product_unavailable',
): NextResponse<ErrorResponse> {
  return NextResponse.json(
    {
      error: {
        code,
        message:
          code === 'invalid_request'
            ? 'The requested Work path is invalid.'
            : 'Product data could not be loaded.',
        request_id: 'web-product-bff',
      },
    },
    { status, headers: productResponseHeaders },
  );
}

function safeUpstreamStatus(status: number): number {
  return status >= 400 && status < 600 ? status : 502;
}
