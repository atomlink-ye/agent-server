export type Capabilities = Readonly<{
  readonly surface: 'loading' | 'product' | 'team' | 'overview';
  readonly canCompose: boolean;
  readonly canRetry: boolean;
}>;

export type CapabilityMeta = Readonly<{
  readonly selection?: Readonly<{ readonly kind?: string }>;
  readonly read_only?: boolean;
}>;

/**
 * The UI boundary for product controls. New capabilities must be added here,
 * rather than introducing a second set of selection/read-only checks.
 */
export function selectCapabilities(meta: CapabilityMeta): Capabilities {
  const surface =
    meta.selection?.kind === 'product_session'
      ? 'product'
      : meta.selection?.kind === 'team_agent_session'
        ? 'team'
        : meta.selection?.kind === 'team_overview'
          ? 'overview'
          : 'loading';
  const productSession = surface === 'product';
  const writable = meta.read_only === false;
  return {
    surface,
    canCompose: productSession && writable,
    canRetry: productSession && writable,
  };
}
