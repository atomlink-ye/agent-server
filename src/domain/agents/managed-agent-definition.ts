import { randomUUID } from 'node:crypto';
import type { ManagedAgentOwner } from './managed-agent-owner.js';

export interface AgentDefinition extends ManagedAgentOwner {
  readonly id: string;
  readonly normalizedName: string;
  readonly displayName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function createManagedAgentDefinition(
  options: Omit<AgentDefinition, 'id' | 'createdAt' | 'updatedAt'> & {
    id?: string;
    now?: () => Date;
  },
): AgentDefinition {
  const at = (options.now ?? (() => new Date()))().toISOString();
  return Object.freeze({
    ...options,
    id: options.id ?? randomUUID(),
    createdAt: at,
    updatedAt: at,
  });
}
