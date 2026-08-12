import {
  invalidProductRequest,
  productSchemaFor,
  readProduct,
} from '@/lib/product-api-bff';
import { GetWorkRunRequestSchema } from '@atomlink-ye/agent-server/product-contract';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ work_id: string; work_run_id: string }>;
  },
) {
  const { work_id: workId, work_run_id: workRunId } = await params;
  if (
    !GetWorkRunRequestSchema.safeParse({
      work_id: workId,
      work_run_id: workRunId,
    }).success
  )
    return invalidProductRequest();
  return readProduct(
    `/api/v1/works/${workId}/runs/${workRunId}`,
    productSchemaFor('run'),
  );
}
