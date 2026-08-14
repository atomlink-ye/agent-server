import type { ManagedAgentOwner } from '../../domain/agents/managed-agent-owner.js';
import type { EnvironmentVersion } from './environment-registry.js';

export interface EnvironmentReadApi {
  findVersion(
    owner: ManagedAgentOwner,
    id: string,
  ): Promise<EnvironmentVersion | null>;
}
