import { randomUUID } from 'node:crypto';
import type { ManagedAgentOwner } from './managed-agent-owner.js';

export interface AgentDefinition extends ManagedAgentOwner {
  readonly id: string;
  readonly normalizedName: string;
  readonly displayName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly roleLabel: string | null;
  readonly summary: string | null;
  /** The Computer namespace this Agent runs under; null means the shared default. */
  readonly computerId: string | null;
}

export function createManagedAgentDefinition(
  options: Omit<
    AgentDefinition,
    'id' | 'createdAt' | 'updatedAt' | 'roleLabel' | 'summary' | 'computerId'
  > & {
    id?: string;
    now?: () => Date;
    roleLabel?: string | null;
    summary?: string | null;
    computerId?: string | null;
  },
): AgentDefinition {
  const { id, now, roleLabel, summary, computerId, ...durable } = options;
  const at = (now ?? (() => new Date()))().toISOString();
  return Object.freeze({
    ...durable,
    id: id ?? randomUUID(),
    createdAt: at,
    updatedAt: at,
    roleLabel: roleLabel ?? null,
    summary: summary ?? null,
    computerId: computerId ?? null,
  });
}
