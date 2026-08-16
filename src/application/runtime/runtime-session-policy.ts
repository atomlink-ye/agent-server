export type RuntimeSessionPolicy = 'fresh' | 'sticky';

export type RuntimeSessionPolicyScope =
  'product_session' | 'team_member' | 'task';

/**
 * Compatibility policy for the behavior-preserving Execution Plane refactor.
 * Product Sessions and Team members retain their existing sticky session reuse,
 * while task-scoped execution remains fresh. Product defaults may change only
 * through a later product decision, not through this architecture refactor.
 */
export function compatibilityRuntimeSessionPolicy(
  scope: RuntimeSessionPolicyScope,
): RuntimeSessionPolicy {
  return scope === 'task' ? 'fresh' : 'sticky';
}
