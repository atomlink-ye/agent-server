import type { ServiceAccountAccessContext } from '../../domain/access-context.js';

export type ApiVariables = {
  requestId: string;
  accessContext: ServiceAccountAccessContext | null;
};

export type ApiEnvironment = {
  Variables: ApiVariables;
};
