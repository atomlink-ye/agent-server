export type Capabilities = Readonly<{
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
  const productSession = meta.selection?.kind === 'product_session';
  const writable = meta.read_only === false;
  return {
    canCompose: productSession && writable,
    canRetry: productSession && writable,
  };
}
