import {
  invalidProductRequest,
  readProduct,
} from '@/lib/product-api-bff';
import { GetProductWorkDefinitionVersionResponseSchema } from '@atomlink-ye/agent-server/product-contract';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ version_id: string }>;
  },
) {
  const { version_id: versionId } = await params;
  if (!UUID.test(versionId)) return invalidProductRequest();
  return readProduct(
    `/api/v1/work-definition-versions/${encodeURIComponent(versionId)}`,
    GetProductWorkDefinitionVersionResponseSchema,
  );
}
