import 'server-only';

import { NextResponse } from 'next/server';

export const productReadNotImplementedBody = Object.freeze({
  error: 'not_implemented',
} as const);

/**
 * Temporary read seam for the Work-first surface.
 *
 * Lane A owns the shared Product Contract decoder and its export gate. Until
 * that gate is open, returning an explicit 501 is safer than inventing a
 * second DTO in apps/web.
 */
export function productReadNotImplemented(): NextResponse {
  return NextResponse.json(productReadNotImplementedBody, {
    status: 501,
    headers: { 'cache-control': 'no-store' },
  });
}
