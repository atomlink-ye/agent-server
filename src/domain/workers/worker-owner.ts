import type { ManagedAgentOwner } from '../agents/managed-agent-owner.js';

/**
 * Formal Worker ownership currently follows the same tenant/workspace/principal
 * scope as authored Agent and Work resources. Keeping a named type prevents
 * Work execution from reusing Agent identity while the enterprise scope model
 * continues to converge.
 */
export type WorkerOwner = ManagedAgentOwner;
