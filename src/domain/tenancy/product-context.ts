export type PrincipalType = 'service_account' | 'user';

export type ProductScope = Readonly<{
  readonly tenantId: string;
  readonly workspaceId: string;
}>;

export type PrincipalRef = Readonly<{
  readonly type: PrincipalType;
  readonly id: string;
}>;

export type ResourceOwner = Readonly<{
  readonly scope: ProductScope;
  readonly principal: PrincipalRef;
}>;

export type ActorContext = Readonly<{
  readonly scope: ProductScope;
  readonly principal: PrincipalRef;
  readonly policySnapshotVersion: string;
}>;

export function productScope(input: {
  readonly tenantId: string;
  readonly workspaceId: string;
}): ProductScope {
  if (!input.tenantId || !input.workspaceId)
    throw new Error('Product scope requires tenantId and workspaceId.');
  return Object.freeze({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
  });
}

export function principalRef(input: {
  readonly principalType: string;
  readonly principalId: string;
}): PrincipalRef {
  if (input.principalType !== 'service_account' && input.principalType !== 'user')
    throw new Error(`Unsupported principal type ${input.principalType}.`);
  if (!input.principalId) throw new Error('Principal id is required.');
  return Object.freeze({ type: input.principalType, id: input.principalId });
}

export function resourceOwner(input: {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
}): ResourceOwner {
  return Object.freeze({
    scope: productScope(input),
    principal: principalRef(input),
  });
}

export function actorContext(input: {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
  readonly policySnapshotVersion: string;
}): ActorContext {
  if (!input.policySnapshotVersion)
    throw new Error('Actor context requires a policy snapshot version.');
  return Object.freeze({
    scope: productScope(input),
    principal: principalRef(input),
    policySnapshotVersion: input.policySnapshotVersion,
  });
}
