import type { ServiceAccountAccessContext } from './access-context.js';

export type ApiVariables = {
  requestId: string;
  accessContext: ServiceAccountAccessContext | null;
};

export type ApiEnvironment = {
  Variables: ApiVariables;
};
