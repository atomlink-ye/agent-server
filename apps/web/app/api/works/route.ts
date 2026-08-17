import { productSchemaFor, readProduct } from '@/lib/product-api-bff';

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
