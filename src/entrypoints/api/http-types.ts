import type { ServiceAccountAccessContext } from '../../platform/access-context.js';

export type ApiVariables = {
  requestId: string;
  accessContext: ServiceAccountAccessContext | null;
};

export type ApiEnvironment = {
  Variables: ApiVariables;
};
