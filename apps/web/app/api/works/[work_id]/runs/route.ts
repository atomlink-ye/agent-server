import {
  invalidProductRequest,
  productSchemaFor,
  readProduct,
} from '@/lib/product-api-bff';
import { ListWorkRunsRequestSchema } from '@atomlink-ye/agent-server/product-contract';

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
  return readProduct(`/api/v1/works/${workId}/runs`, productSchemaFor('runs'));
}
