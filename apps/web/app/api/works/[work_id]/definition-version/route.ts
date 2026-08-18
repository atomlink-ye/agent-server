import {
  invalidProductRequest,
  productSchemaFor,
  writeProduct,
} from '@/lib/product-api-bff';
import { UpdateWorkDefinitionVersionRequestSchema } from '@atomlink-ye/agent-server/product-contract';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ work_id: string }>;
  },
) {
  const { work_id: workId } = await params;
  if (!UUID.test(workId)) return invalidProductRequest();
  const parsed = UpdateWorkDefinitionVersionRequestSchema.safeParse(
    await request.json().catch(() => undefined),
  );
  if (!parsed.success) return invalidProductRequest();
  return writeProduct(
    `/api/v1/works/${encodeURIComponent(workId)}/definition-version`,
    parsed.data,
    productSchemaFor('pin-definition'),
  );
}
