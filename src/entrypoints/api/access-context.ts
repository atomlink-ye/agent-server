import type { ServiceAccountAccessContext } from '../../domain/access-context.js';

export interface AccessContextRequest {
  get(key: 'accessContext'): ServiceAccountAccessContext | null;
}

export function getAuthenticatedAccessContext(
  request: AccessContextRequest,
): ServiceAccountAccessContext {
  const accessContext = request.get('accessContext');
  if (!accessContext)
    throw new Error('Authenticated access context is not available');
  return accessContext;
}
