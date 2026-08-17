import { productSchemaFor, readAllProductListPages } from '@/lib/product-api-bff';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

export async function GET() {
  return readAllProductListPages(
    '/api/v1/works',
    'works',
    productSchemaFor('works'),
  );
}
