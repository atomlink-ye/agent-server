import 'server-only';

const productApiBaseUrl = process.env.AGENT_SERVER_BASE_URL;
const productApiServiceToken = process.env.AGENT_SERVER_SERVICE_TOKEN;

export class ProductApiClientError extends Error {
  constructor(readonly code: 'configuration_missing' | 'invalid_path') {
    super(code);
  }
}

/**
 * Server-only transport for the Product API. The BFF must decode the response
 * before returning anything to the browser; this helper never runs in a
 * browser bundle and never returns the service token.
 *
 * Stage 1 deliberately leaves the call site behind the Lane A contract gate.
 */
export async function getProductApi(path: string): Promise<Response> {
  if (!path.startsWith('/api/v1/works'))
    throw new ProductApiClientError('invalid_path');
  if (!productApiBaseUrl || !productApiServiceToken)
    throw new ProductApiClientError('configuration_missing');

  return fetch(`${productApiBaseUrl.replace(/\/$/u, '')}${path}`, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${productApiServiceToken}`,
    },
  });
}
