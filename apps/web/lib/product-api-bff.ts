import { NextResponse } from 'next/server';
import { type ZodType } from 'zod';

import { getProductApi } from '@/lib/product-api-client';
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
/**
 * Fetches all pages of a Product list endpoint using cursor traversal, then
 * returns a single merged response with next_cursor: null.
 *
 * The Product API is oldest-first with no sort parameter (backend gap:
 * no order/sort query param on listWorks/listWorkRuns). Using limit=100
 * minimises round trips for typical Work counts in MVE context.
 */
export async function readAllProductListPages(
  basePath: string,
  listKey: 'works' | 'work_runs',
  schema: ZodType<unknown>,
): Promise<NextResponse> {
  const allItems: unknown[] = [];
  let cursor: string | null = null;
  const MAX_PAGES = 50; // safety cap: 50 × 100 = 5 000 items
  let page = 0;

  do {
    const pagePath =
      cursor !== null
        ? `${basePath}?limit=100&cursor=${encodeURIComponent(cursor)}`
        : `${basePath}?limit=100`;

    let upstream: Response;
    try {
      upstream = await getProductApi(pagePath);
    } catch (error) {
      return safeFailure(
        error instanceof ProductApiClientError ? error : undefined,
        503,
      );
    }

    const body = await readJson(upstream);
    if (upstream.status < 200 || upstream.status >= 300) {
      const decodedError = decodeProductResponse(body, ErrorResponseSchema);
      if (!decodedError.success) return safeFailure(undefined, 502);
      return NextResponse.json(decodedError.data, {
        status: safeUpstreamStatus(upstream.status),
        headers: productResponseHeaders,
      });
    }

    const raw = body as Record<string, unknown>;
    const pageItems = Array.isArray(raw[listKey]) ? (raw[listKey] as unknown[]) : [];
    allItems.push(...pageItems);
    const next = raw['next_cursor'];
    cursor = typeof next === 'string' && next.length > 0 ? next : null;
    page += 1;
  } while (cursor !== null && page < MAX_PAGES);

  const merged = { [listKey]: allItems, next_cursor: null };
  const decoded = decodeProductResponse(merged, schema);
  if (!decoded.success) return safeFailure(undefined, 502);
  return NextResponse.json(decoded.data, {
    status: 200,
    headers: {
      ...productResponseHeaders,
      [upstreamFetchedHeader]: 'fetched',
    },
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
