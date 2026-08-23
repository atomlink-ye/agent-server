/** Capabilities that affect pure runtime reconciliation decisions. */
export interface RuntimeProviderCapabilities {
  /** Whether an existing provider session can apply mutable spec changes. */
  readonly canReconfigure: boolean;
}
