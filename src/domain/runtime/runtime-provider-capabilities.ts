/** Capabilities that affect pure runtime reconciliation decisions. */
export interface RuntimeProviderCapabilities {
  /** Whether an existing provider session can apply mutable spec changes. */
  readonly canReconfigure: boolean;
  /** Whether the provider can delete/archive one external provider session. */
  readonly canCloseSession: boolean;
}
