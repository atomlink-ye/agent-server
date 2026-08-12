import { expect, it } from 'vitest';

import {
  productReadNotImplemented,
  productReadNotImplementedBody,
} from '@/lib/product-api-bff';

it('keeps the Stage 1 read seam explicitly machine-readable', async () => {
  const response = productReadNotImplemented();

  expect(response.status).toBe(501);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual(productReadNotImplementedBody);
});
