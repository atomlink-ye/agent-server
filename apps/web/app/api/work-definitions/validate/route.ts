import {
  invalidProductRequest,
  workDefinitionAuthoringErrorSchema,
  writeProduct,
} from '@/lib/product-api-bff';
import {
  WorkDefinitionSourceRequestSchema,
  WorkDefinitionValidateSuccessSchema,
} from '@atomlink-ye/agent-server/product-contract';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const parsed = WorkDefinitionSourceRequestSchema.safeParse(
    await request.json().catch(() => undefined),
  );
  if (!parsed.success) return invalidProductRequest();
  return writeProduct(
    '/api/v1/work-definitions:validate',
    parsed.data,
    WorkDefinitionValidateSuccessSchema,
    { errorSchema: workDefinitionAuthoringErrorSchema },
  );
}
