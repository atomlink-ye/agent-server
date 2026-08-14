import type { ExecutionWorkspaceBinding } from './execution-plane.js';

export type RuntimeWorkspaceScope =
  | { readonly kind: 'product_session'; readonly id: string }
  | { readonly kind: 'team_run'; readonly id: string };

export interface RuntimeWorkspace {
  readonly id: string;
  readonly scope: RuntimeWorkspaceScope;
  readonly productWorkspaceId: string;
  readonly binding: ExecutionWorkspaceBinding | null;
}

export interface RuntimeWorkspaceRepository {
  findForProductSession(input: {
    readonly productSessionId: string;
    readonly tenantId: string;
    readonly productWorkspaceId: string;
    readonly principalType: string;
    readonly principalId: string;
  }): Promise<RuntimeWorkspace>;
  findForTeamRun(input: {
    readonly teamRunId: string;
    readonly tenantId: string;
    readonly productWorkspaceId: string;
    readonly principalType: string;
    readonly principalId: string;
  }): Promise<RuntimeWorkspace>;
}

export function runtimeWorkspaceIdentity(scope: RuntimeWorkspaceScope): string {
  return `${scope.kind}:${scope.id}`;
}
