import type { Hono } from 'hono';
import { z } from 'zod';

import { ServiceAccountAuthenticator } from '../../../application/control-plane/service-account-authenticator.js';
import { validateProductWorkDefinition } from '../../../application/work/validate-product-work-definition.js';
import { HttpError } from '../../../contracts/http.js';
import type { ApiEnvironment } from '../../../platform/http-types.js';
import type { AppConfig } from '../../../shared/config.js';
import { requireServiceAccountAccess } from '../authentication.js';
import { readBoundedJson } from '../read-bounded-json.js';

const ValidateWorkDefinitionRequestSchema = z
  .object({
    source: z.string().min(1).max(64 * 1024),
  })
  .strict();

export function registerProductWorkDefinitionRoutes(
  app: Hono<ApiEnvironment>,
  dependencies: { readonly config: AppConfig },
): void {
  const authenticator = new ServiceAccountAuthenticator(
    dependencies.config.serviceAccounts ?? [],
  );
  app.use(
    '/api/v1/work-definitions:validate',
    requireServiceAccountAccess(authenticator),
  );

  app.post('/api/v1/work-definitions:validate', async (context) => {
    const request = ValidateWorkDefinitionRequestSchema.safeParse(
      await readBoundedJson(context.req.raw, 64 * 1024),
    );
    if (!request.success)
      throw new HttpError(
        400,
        'invalid_request',
        'A Work Definition source string is required.',
      );

    const result = validateProductWorkDefinition(request.data.source);
    if (!result.valid) return context.json(result, 422);
    return context.json(
      {
        valid: true,
        fingerprint: result.fingerprint,
        metadata: {
          normalized_name: result.metadata.normalizedName,
        },
        diagnostics: result.diagnostics,
      },
      200,
    );
  });
}
