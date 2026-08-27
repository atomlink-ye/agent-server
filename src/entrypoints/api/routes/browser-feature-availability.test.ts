import { Hono } from 'hono';
import { expect, it } from 'vitest';

import type { ApiEnvironment } from '../http-types.js';
import { createBrowserFeatureAvailabilityGuard } from './browser-feature-availability.js';
import { PRODUCT_WORK_BROWSER_ROUTE_PREFIXES } from './browser-route-prefixes.js';

it('guards the runtime capability projection with the Product Work surface', async () => {
  const app = new Hono<ApiEnvironment>();
  app.use(
    '*',
    createBrowserFeatureAvailabilityGuard(
      PRODUCT_WORK_BROWSER_ROUTE_PREFIXES,
      'Work management is not available in this environment.',
    ),
  );
  app.get('/api/runtime-capabilities', (context) =>
    context.json({ supported_runtime_capabilities: [] }, 200),
  );

  const response = await app.request('/api/runtime-capabilities');

  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({
    error: { code: 'feature_unavailable' },
  });
});
