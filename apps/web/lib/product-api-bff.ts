import { NextResponse } from 'next/server';
import { type ZodType } from 'zod';

import { getProductApi, postProductApi } from '@/lib/product-api-client';
import { ProductApiClientError } from '@/lib/product-api-client';
import { decodeProductResponse } from '@/lib/product-api-decoder';

export { decodeProductResponse } from '@/lib/product-api-decoder';

import {
  ErrorResponseSchema,
  type ErrorResponse,
  GetWorkResponseSchema,
  ProductRunTraceResponseSchema,
  ProductWorkRunResponseSchema,
  WorkListResponseSchema,
  WorkRunListResponseSchema,
  StartWorkRunResponseSchema,
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
    const decoded = decodeProductResponse(body, schema);
    if (!decoded.success) return safeFailure(undefined, 502);
    return NextResponse.json(decoded.data, {
      status: upstream.status,
      headers: {
        ...productResponseHeaders,
        [upstreamFetchedHeader]: 'fetched',
      },
    });
  }

  const decodedError = decodeProductResponse(body, ErrorResponseSchema);
  if (!decodedError.success) return safeFailure(undefined, 502);
  return NextResponse.json(decodedError.data, {
    status: safeUpstreamStatus(upstream.status),
    headers: productResponseHeaders,
  });
}

export async function writeProduct(
  path: string,
  requestBody: unknown,
  schema: ZodType<unknown>,
): Promise<NextResponse> {
  let upstream: Response;
  try {
    upstream = await postProductApi(path, requestBody);
  } catch (error) {
    return safeFailure(
      error instanceof ProductApiClientError ? error : undefined,
      503,
    );
  }

  const body = await readJson(upstream);
  if (upstream.status >= 200 && upstream.status < 300) {
    const decoded = decodeProductResponse(body, schema);
    if (!decoded.success) return safeFailure(undefined, 502);
    return NextResponse.json(decoded.data, {
      status: upstream.status,
      headers: {
        ...productResponseHeaders,
        [upstreamFetchedHeader]: 'fetched',
      },
    });
  }

  const decodedError = decodeProductResponse(body, ErrorResponseSchema);
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
  route: 'works' | 'work' | 'runs' | 'run' | 'trace' | 'start-run',
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
    case 'start-run':
      return StartWorkRunResponseSchema;
  }
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
