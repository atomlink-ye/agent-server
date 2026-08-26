import type { MiddlewareHandler } from 'hono';

import type { ErrorResponse } from '../../../contracts/http.js';
import type { ApiEnvironment } from '../http-types.js';

/**
 * Builds a middleware that turns any request whose path starts with one of
 * `prefixes` into a browser-safe 503 `feature_unavailable`, instead of
 * letting it fall through to a browser BFF route that forwards to an
 * upstream surface that was never installed. Without this guard, the
 * request lands on the generic `route_not_found` 404 the app-level
 * `notFound` handler returns, which the browser cannot distinguish from a
 * typo'd URL.
 *
 * Prefixes are matched literally against the request path (exact match or
 * `${prefix}/...`), so this guard cannot drift from the route tables it is
 * meant to protect: it carries no knowledge of which routes exist, only the
 * same path strings those route registrations use.
 *
 * Availability is asserted from configuration at registration time. This
 * middleware never inspects an upstream response to decide whether a
 * feature is "on" -- the BFF cannot tell an uninstalled route apart from an
 * unrelated failure that way.
 */
export function createBrowserFeatureAvailabilityGuard(
  prefixes: readonly string[],
  message: string,
): MiddlewareHandler<ApiEnvironment> {
  return async (context, next) => {
    const path = context.req.path;
    const blocked = prefixes.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    );
    if (!blocked) {
      await next();
      return;
    }

    return context.json(
      errorResponse('feature_unavailable', message, context.get('requestId')),
      503,
    );
  };
}

function errorResponse(
  code: string,
  message: string,
  requestId: string,
): ErrorResponse {
  return {
    error: {
      code,
      message,
      request_id: requestId,
    },
  };
}
