import {
  invalidProductRequest,
  readProduct,
  writeProduct,
  productSchemaFor,
} from '@/lib/product-api-bff';
import {
  CreateWorkRequestSchema,
  CreateWorkResponseSchema,
} from '@atomlink-ye/agent-server/product-contract';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

export async function GET() {
  return readProduct(
    '/api/v1/works?limit=100&order=updated_desc',
    productSchemaFor('works'),
  );
}

export async function POST(request: Request) {
  const idempotencyKey = request.headers.get('idempotency-key')?.trim() ?? '';
  if (idempotencyKey) return invalidProductRequest();
  const parsed = CreateWorkRequestSchema.safeParse(
    await request.json().catch(() => undefined),
  );
  if (!parsed.success) return invalidProductRequest();
  return writeProduct('/api/v1/works', parsed.data, CreateWorkResponseSchema);
}
