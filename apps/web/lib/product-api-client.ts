import 'server-only';

const uuidPath =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const productReadPath = new RegExp(
  `^/api/v1/works(?:/(?:${uuidPath})(?:/runs(?:/(?:${uuidPath})(?:/trace)?)?)?)?$`,
  'iu',
);

export class ProductApiClientError extends Error {
  constructor(
    readonly code: 'configuration_missing' | 'invalid_path' | 'unavailable',
  ) {
    super(code);
    this.name = 'ProductApiClientError';
  }
}

/** Server-only transport for the five accepted Product read routes. */
export async function getProductApi(path: string): Promise<Response> {
  if (!productReadPath.test(path))
    throw new ProductApiClientError('invalid_path');

  const baseUrl = process.env.AGENT_SERVER_BASE_URL;
  const serviceToken = process.env.AGENT_SERVER_SERVICE_TOKEN;
  if (!baseUrl || !serviceToken)
    throw new ProductApiClientError('configuration_missing');

  try {
    return await fetch(`${baseUrl.replace(/\/$/u, '')}${path}`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${serviceToken}`,
      },
    });
  } catch {
    throw new ProductApiClientError('unavailable');
  }
}
