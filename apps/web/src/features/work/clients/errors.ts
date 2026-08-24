import { apiTransport, ApiTransportError } from '../../../api/transport';

export class ProductReadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ProductReadError';
  }
}

export class ProductMutationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ProductMutationError';
  }
}

export async function readProductJson(
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  try {
    return await apiTransport.request(path, init);
  } catch (error) {
    if (error instanceof ApiTransportError) {
      throw new ProductReadError(error.message, error.status);
    }
    throw error;
  }
}

export function productMutationError(error: unknown): never {
  if (error instanceof ApiTransportError) {
    throw new ProductMutationError(error.message, error.status);
  }
  throw error;
}

export function parseProduct<T>(
  schema: { parse(value: unknown): T },
  value: unknown,
): T {
  try {
    return schema.parse(value);
  } catch {
    throw new Error('The Product response was invalid.');
  }
}

export function readOptionalProductJson(
  path: string,
  init: RequestInit = {},
): Promise<unknown | null> {
  return readProductJson(path, init).catch((error: unknown) => {
    if (error instanceof ProductReadError && error.status === 404) return null;
    throw error;
  });
}
