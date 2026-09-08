export interface WorkspaceMembershipRepository {
  /**
   * Idempotently records that a principal works in a workspace. Admission is
   * refused for a workspace that does not exist in the tenant, so a forged
   * workspace id cannot mint a membership.
   */
  ensureMember(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly principalType: string;
    readonly principalId: string;
    /** Set only on first insert; an existing row keeps its display name. */
    readonly displayName?: string;
  }): Promise<void>;

  /**
   * Names for whichever of the given principals have one on record. A
   * principal with no display name yet is simply absent from the result --
   * callers fall back to showing something else, never to a blank string.
   */
  findDisplayNames(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly principalIds: readonly string[];
  }): Promise<ReadonlyMap<string, string>>;

  /** Sets or replaces the name a workspace member is called by. */
  setDisplayName(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly principalType: string;
    readonly principalId: string;
    readonly displayName: string;
  }): Promise<void>;
}
