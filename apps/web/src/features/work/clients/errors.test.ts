import { describe, expect, it } from 'vitest';

import { ApiTransportError } from '../../../api/transport';
import { isFeatureUnavailable } from '../../../api/feature-availability';
import { ProductMutationError, ProductReadError } from './errors';

/**
 * The availability model documented in `docs/frontend.md` ("Surface
 * availability") rests on one durable contract: the upstream `error.code`
 * survives every re-wrapping between the transport and the caller that has to
 * decide what to render.
 *
 * If a wrapper drops `code`, a permanently unavailable surface becomes
 * indistinguishable from a transient failure, and the caller offers a Retry
 * that can never succeed. That regression is silent — types still check and
 * every other test still passes — so it is guarded here rather than left to be
 * rediscovered from a browser session.
 */
describe('product client errors preserve the availability code', () => {
  const unavailable = new ApiTransportError(
    503,
    'feature_unavailable',
    'Work management is not available in this environment.',
  );

  it('keeps the code when a read failure is re-wrapped', () => {
    const wrapped = new ProductReadError(
      unavailable.message,
      unavailable.status,
      unavailable.code,
    );

    expect(wrapped.code).toBe('feature_unavailable');
    expect(isFeatureUnavailable(wrapped)).toBe(true);
  });

  it('keeps the code when a mutation failure is re-wrapped', () => {
    const wrapped = new ProductMutationError(
      unavailable.message,
      unavailable.status,
      unavailable.code,
    );

    expect(wrapped.code).toBe('feature_unavailable');
    expect(isFeatureUnavailable(wrapped)).toBe(true);
  });

  it('does not treat an ordinary transport failure as unavailable', () => {
    const offline = new ApiTransportError(
      0,
      'network_error',
      'Failed to fetch',
    );

    expect(isFeatureUnavailable(offline)).toBe(false);
    expect(
      isFeatureUnavailable(
        new ProductMutationError(offline.message, offline.status, offline.code),
      ),
    ).toBe(false);
  });
});
