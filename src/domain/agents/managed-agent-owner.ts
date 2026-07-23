export interface ManagedAgentOwner {
  readonly tenantId: string;
  readonly principalType: string;
  readonly principalId: string;
}

export function managedAgentOwnerKey(owner: ManagedAgentOwner): string {
  return `${owner.tenantId}\u0000${owner.principalType}\u0000${owner.principalId}`;
}

/** Identity normalization is deliberately independent of workspace and display text. */
export function normalizeManagedAgentName(name: string): string {
  return name
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}
