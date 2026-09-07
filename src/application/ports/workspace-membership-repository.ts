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
  }): Promise<void>;
}
