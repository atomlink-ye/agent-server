import type {
  AccessContext,
  ServiceAccountAccessContext,
  UserAccessContext,
} from '../../domain/access-context.js';

/**
 * Internal BFF-to-API identity propagation. The browser never supplies this
 * header; the browser session middleware establishes it before forwarding.
 */
export const USER_ID_HEADER = 'x-agent-server-user-id';

export interface AccessContextRequest {
  get(key: 'accessContext'): ServiceAccountAccessContext | null;
  get(key: 'userAccessContext'): UserAccessContext | null;
}

export function getAuthenticatedAccessContext(
  request: AccessContextRequest,
): ServiceAccountAccessContext {
  const accessContext = request.get('accessContext');
  if (!accessContext)
    throw new Error('Authenticated access context is not available');
  return accessContext;
}

/**
 * The effective principal for this request: the human behind a browser call
 * when one was forwarded via `USER_ID_HEADER`, otherwise the authenticated
 * service account. Callers that must attribute writes to a real person
 * (e.g. work-item comments, for the wake-loop human-reset check) should use
 * this instead of `getAuthenticatedAccessContext`.
 */
export function getRequestAccessContext(
  request: AccessContextRequest,
): AccessContext {
  return (
    request.get('userAccessContext') ?? getAuthenticatedAccessContext(request)
  );
}

/** Returns only the identity established by the server session middleware. */
export function getBrowserUserId(request: {
  get(key: 'browserUserId'): string | null;
}): string | null {
  return request.get('browserUserId');
}
