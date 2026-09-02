import type {
  AccessContext,
  ServiceAccountAccessContext,
  UserAccessContext,
} from '../../domain/access-context.js';

/**
 * Carries a stable human identifier from the browser BFF to the real API so
 * `requireServiceAccountAccess` can mint a `UserAccessContext` on top of the
 * already-authenticated service account, instead of every browser-originated
 * write being attributed to the shared service account.
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
