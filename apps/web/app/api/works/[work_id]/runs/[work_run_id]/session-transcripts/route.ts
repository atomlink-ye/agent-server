import { invalidProductRequest, readProduct } from '@/lib/product-api-bff';
import { ProductSessionTranscriptsResponseSchema } from '@atomlink-ye/agent-server/product-contract';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'no-store';
export const runtime = 'nodejs';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ work_id: string; work_run_id: string }>;
  },
) {
  const { work_id: workId, work_run_id: workRunId } = await params;
  if (!UUID.test(workId) || !UUID.test(workRunId))
    return invalidProductRequest();
  return readProduct(
    `/api/v1/works/${encodeURIComponent(workId)}/runs/${encodeURIComponent(workRunId)}/session-transcripts`,
    ProductSessionTranscriptsResponseSchema,
  );
}
