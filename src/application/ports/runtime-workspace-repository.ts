import type { ExecutionWorkspaceBinding } from './execution-plane.js';

export type RuntimeWorkspaceScope =
  | { readonly kind: 'product_session'; readonly id: string }
  | { readonly kind: 'team_run'; readonly id: string };

/**
 * Provider/runtime-side workspace state. `productWorkspaceId` points back to
 * the long-lived ProductWorkspace; `binding` is the ExecutionPlane cwd/binding.
 */
export interface ExecutionWorkspaceState {
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
  }): Promise<ExecutionWorkspaceState>;
  findForTeamRun(input: {
    readonly teamRunId: string;
    readonly tenantId: string;
    readonly productWorkspaceId: string;
    readonly principalType: string;
    readonly principalId: string;
  }): Promise<ExecutionWorkspaceState>;
}

export function runtimeWorkspaceIdentity(scope: RuntimeWorkspaceScope): string {
  return `${scope.kind}:${scope.id}`;
}
