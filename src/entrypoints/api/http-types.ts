import type {
  ServiceAccountAccessContext,
  UserAccessContext,
} from '../../domain/access-context.js';

export type ApiVariables = {
  requestId: string;
  accessContext: ServiceAccountAccessContext | null;
  /**
   * Populated only when the caller forwarded a human-identity header
   * (`USER_ID_HEADER`) alongside a valid service-account Bearer token. Null
   * for ordinary agent/API-to-API calls, which stay attributed to the
   * service account.
   */
  userAccessContext: UserAccessContext | null;
};

export type ApiEnvironment = {
  Variables: ApiVariables;
};
