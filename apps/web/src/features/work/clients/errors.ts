import { apiTransport, ApiTransportError } from '../../../api/transport';
import { isFeatureUnavailable } from '../../../api/feature-availability';

export class ProductReadError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = 'ProductReadError';
  }
}

export class ProductMutationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    // The upstream `error.code` must survive re-wrapping: a mutation that
    // fails because the surface is not composed is `feature_unavailable`,
    // and `isFeatureUnavailable()` matches structurally on `code`. Dropping
    // it here would make a permanently-unavailable mutation indistinguishable
    // from a transient failure, and the caller would offer a Retry that can
    // never succeed.
    readonly code: string | null = null,
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
      throw new ProductReadError(error.message, error.status, error.code);
    }
    throw error;
  }
}

export function productMutationError(error: unknown): never {
  if (error instanceof ApiTransportError) {
    throw new ProductMutationError(error.message, error.status, error.code);
  }
  throw error;
}

// A Run that fails for one of these reasons cannot be retried into success:
// the composition itself is impossible in this deployment. Offering Retry
// for these would be a false promise — see docs/frontend.md "unavailable
// offers no Retry, because a retry cannot succeed" and "Controls that
// cannot succeed in the current state are disabled rather than offered."
const PERMANENT_RUN_FAILURE_CODES = new Set([
  'unsupported_runtime_capability',
  'feature_unavailable',
]);

/**
 * A permanent Run-start failure is a fact about this Work's composition or
 * this deployment, not a transient hiccup: retrying it cannot succeed, so
 * the caller must not offer Retry and must disable the start control.
 */
export function isPermanentRunFailure(error: unknown): boolean {
  return (
    error instanceof ProductMutationError &&
    error.code !== null &&
    PERMANENT_RUN_FAILURE_CODES.has(error.code)
  );
}

/**
 * Run failures can contain provider or transport detail that is useful to an
 * operator but inappropriate for a browser surface. A `ProductMutationError`
 * carrying one of the bounded, product-owned codes above is safe to show
 * verbatim — it is deliberate product prose, not raw provider/transport
 * detail. Anything else keeps the existing bounded, generic message so an
 * unbounded upstream string never reaches the browser.
 */
export function workRunFailureMessage(error: unknown): string {
  if (isFeatureUnavailable(error))
    return "This workspace doesn't currently offer Work execution. This Run can't start here.";
  if (
    error instanceof ProductMutationError &&
    error.code === 'unsupported_runtime_capability'
  )
    return error.message;
  return 'We couldn’t start this Run. Check that Work is ready, then try again.';
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
