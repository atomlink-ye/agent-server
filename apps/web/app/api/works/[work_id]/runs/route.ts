import {
  invalidProductRequest,
  productSchemaFor,
  readProduct,
  writeProduct,
} from '@/lib/product-api-bff';
import {
  GetWorkRequestSchema,
  ListWorkRunsRequestSchema,
  StartWorkRunRequestSchema,
} from '@atomlink-ye/agent-server/product-contract';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ work_id: string }>;
  },
) {
  const { work_id: workId } = await params;
  if (!ListWorkRunsRequestSchema.safeParse({ work_id: workId }).success)
    return invalidProductRequest();
  return readProduct(
    `/api/v1/works/${encodeURIComponent(workId)}/runs?limit=100&order=created_desc`,
    productSchemaFor('runs'),
  );
}

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ work_id: string }>;
  },
) {
  const { work_id: workId } = await params;
  if (!GetWorkRequestSchema.safeParse({ work_id: workId }).success)
    return invalidProductRequest();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidProductRequest();
  }
  const parsed = StartWorkRunRequestSchema.safeParse(body);
  if (!parsed.success) return invalidProductRequest();
  return writeProduct(
    `/api/v1/works/${encodeURIComponent(workId)}/runs`,
    parsed.data,
    productSchemaFor('start-run'),
  );
}
