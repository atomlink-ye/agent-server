import type { PrincipalRef, ProductScope } from '../tenancy/product-context.js';
import type { AgentHomeNamespace } from '../agents/agent-home.js';

export type AgentHomeContextNamespace = Exclude<
  AgentHomeNamespace,
  'definition'
>;

/**
 * Canonical durable ownership for product-world files. Runtime views mount one
 * or more of these scopes; an Agent is never implicitly the storage owner of a
 * Work or Conversation scope.
 */
export type ContextScope =
  | Readonly<{ kind: 'organization'; tenantId: string }>
  | Readonly<{ kind: 'workspace'; tenantId: string; workspaceId: string }>
  | Readonly<{
      kind: 'agent';
      tenantId: string;
      agentDefinitionId: string;
    }>
  | Readonly<{
      kind: 'agent_home';
      tenantId: string;
      agentDefinitionId: string;
      namespace: AgentHomeContextNamespace;
      scopeKey: string;
    }>
  | Readonly<{
      kind: 'agent_user';
      tenantId: string;
      agentDefinitionId: string;
      principal: PrincipalRef;
    }>
  | Readonly<{
      kind: 'conversation';
      tenantId: string;
      conversationId: string;
    }>
  | Readonly<{
      kind: 'work';
      tenantId: string;
      workspaceId: string;
      workId: string;
    }>
  | Readonly<{
      kind: 'runtime_scratch';
      tenantId: string;
      runtimeSessionId: string;
    }>;

export type ContextViewKind = 'chat' | 'worker' | 'agent_home';
export type ContextAccessMode = 'read_only' | 'read_write';

export interface ContextMount {
  readonly mountPath:
    | '/agent'
    | '/organization'
    | '/workspace'
    | '/user'
    | '/conversation'
    | '/input'
    | '/work'
    | '/scratch';
  readonly scope: ContextScope;
  readonly access: ContextAccessMode;
  /** Optional path prefix within the canonical scope. */
  readonly pathPrefix?: string;
}

export interface ContextView {
  readonly kind: ContextViewKind;
  readonly mounts: readonly ContextMount[];
}

export function contextScopeTenantId(scope: ContextScope): string {
  return scope.tenantId;
}

/** Stable database key within (tenant_id, scope_kind). */
export function contextScopeStorageKey(scope: ContextScope): string {
  switch (scope.kind) {
    case 'organization':
      return '';
    case 'workspace':
      return scope.workspaceId;
    case 'agent':
      return scope.agentDefinitionId;
    case 'agent_home':
      return [scope.agentDefinitionId, scope.namespace, scope.scopeKey]
        .map(escapeScopePart)
        .join(':');
    case 'agent_user':
      return [scope.agentDefinitionId, scope.principal.type, scope.principal.id]
        .map(escapeScopePart)
        .join(':');
    case 'conversation':
      return scope.conversationId;
    case 'work':
      return [scope.workspaceId, scope.workId].map(escapeScopePart).join(':');
    case 'runtime_scratch':
      return scope.runtimeSessionId;
  }
}

export function contextScopeKind(scope: ContextScope): ContextScope['kind'] {
  return scope.kind;
}

export function organizationContextScope(tenantId: string): ContextScope {
  return Object.freeze({ kind: 'organization', tenantId });
}

export function workspaceContextScope(scope: ProductScope): ContextScope {
  return Object.freeze({
    kind: 'workspace',
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
  });
}

export function agentContextScope(input: {
  readonly tenantId: string;
  readonly agentDefinitionId: string;
}): ContextScope {
  return Object.freeze({ kind: 'agent', ...input });
}

export function agentHomeContextScope(input: {
  readonly tenantId: string;
  readonly agentDefinitionId: string;
  readonly namespace: AgentHomeContextNamespace;
  readonly scopeKey: string;
}): ContextScope {
  return Object.freeze({ kind: 'agent_home', ...input });
}

export function agentUserContextScope(input: {
  readonly tenantId: string;
  readonly agentDefinitionId: string;
  readonly principal: PrincipalRef;
}): ContextScope {
  return Object.freeze({ kind: 'agent_user', ...input });
}

export function conversationContextScope(input: {
  readonly tenantId: string;
  readonly conversationId: string;
}): ContextScope {
  return Object.freeze({ kind: 'conversation', ...input });
}

export function workContextScope(input: {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly workId: string;
}): ContextScope {
  return Object.freeze({ kind: 'work', ...input });
}

export function runtimeScratchContextScope(input: {
  readonly tenantId: string;
  readonly runtimeSessionId: string;
}): ContextScope {
  return Object.freeze({ kind: 'runtime_scratch', ...input });
}

function escapeScopePart(value: string): string {
  return encodeURIComponent(value);
}
