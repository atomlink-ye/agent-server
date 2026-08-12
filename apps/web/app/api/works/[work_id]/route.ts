import {
  invalidProductRequest,
  productSchemaFor,
  readProduct,
} from '@/lib/product-api-bff';
import { GetWorkRequestSchema } from '@atomlink-ye/agent-server/product-contract';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

export async function GET({
  params,
}: {
  params: Promise<{ work_id: string }>;
}) {
  const { work_id: workId } = await params;
  if (!GetWorkRequestSchema.safeParse({ work_id: workId }).success)
    return invalidProductRequest();
  return readProduct(`/api/v1/works/${workId}`, productSchemaFor('work'));
}
