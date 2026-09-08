/**
 * The Computer layer names where an Agent's execution namespace lives: the
 * managed cloud runtime, a paired local machine, or a paired VPS. It carries
 * no pairing protocol, credential, or scheduling state yet -- it is an
 * identity an `AgentDefinition` can point at, matching the Cumora reference
 * shape closely enough to converge on later without a rewrite.
 */
export type ComputerKind = 'cloud' | 'local' | 'vps';

export type ComputerStatus = 'online' | 'offline';

export interface Computer {
  readonly id: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly kind: ComputerKind;
  readonly name: string;
  readonly status: ComputerStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}
