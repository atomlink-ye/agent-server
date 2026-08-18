import 'server-only';

const uuidPath =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const productReadPath = new RegExp(
  `^(?:/api/v1/works(?:/(?:${uuidPath})(?:/runs(?:/(?:${uuidPath})(?:/trace)?)?)?)?|/api/v1/work-definition-versions/(?:${uuidPath}))$`,
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

/** Server-only transport for accepted Product reads used by the Work-first UI. */
export async function getProductApi(path: string): Promise<Response> {
  if (!productReadPath.test(path.split('?')[0] ?? ''))
    throw new ProductApiClientError('invalid_path');

  const { baseUrl, serviceToken } = productConnection();
  try {
    return await fetch(`${baseUrl}${path}`, {
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

const productWritePath = new RegExp(
  `^(?:/api/v1/works/(?:${uuidPath})/(?:runs|definition-version)|/api/v1/work-definitions:(?:validate|plan|apply))$`,
  'iu',
);

/** Server-only transport for bounded Product authoring and Run commands. */
export async function postProductApi(
  path: string,
  body: unknown,
  options: { readonly idempotencyKey?: string } = {},
): Promise<Response> {
  if (!productWritePath.test(path))
    throw new ProductApiClientError('invalid_path');
  const applyingDefinition = path === '/api/v1/work-definitions:apply';
  if (applyingDefinition !== Boolean(options.idempotencyKey))
    throw new ProductApiClientError('invalid_path');

  const { baseUrl, serviceToken } = productConnection();
  try {
    return await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${serviceToken}`,
        'content-type': 'application/json',
        ...(options.idempotencyKey
          ? { 'idempotency-key': options.idempotencyKey }
          : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ProductApiClientError('unavailable');
  }
}

function productConnection() {
  const baseUrl = process.env.AGENT_SERVER_BASE_URL;
  const serviceToken = process.env.AGENT_SERVER_SERVICE_TOKEN;
  if (!baseUrl || !serviceToken)
    throw new ProductApiClientError('configuration_missing');
  return { baseUrl: baseUrl.replace(/\/$/u, ''), serviceToken };
}
