import type {
  ManagedEnvironmentPackage,
  ParsedManagedEnvironmentPackage,
} from '../../domain/environments/managed-environment-package.js';
import type { ManagedAgentOwner } from '../../domain/agents/managed-agent-owner.js';
export interface EnvironmentDefinition extends ManagedAgentOwner {
  readonly id: string;
  readonly normalizedName: string;
  readonly displayName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface EnvironmentVersion extends ManagedAgentOwner {
  readonly id: string;
  readonly definitionId: string;
  readonly status: 'draft' | 'published';
  readonly displayName: string;
  readonly package: ManagedEnvironmentPackage;
  readonly canonicalJson: string;
  readonly fingerprint: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
}
export interface EnvironmentRegistry {
  importEnvironment(c: {
    owner: ManagedAgentOwner;
    idempotencyKey: string;
    requestFingerprint: string;
    definition: EnvironmentDefinition;
    version: EnvironmentVersion;
  }): Promise<any>;
  publishEnvironmentVersion(c: {
    owner: ManagedAgentOwner;
    idempotencyKey: string;
    requestFingerprint: string;
    versionId: string;
  }): Promise<EnvironmentVersion>;
  findVersion(
    owner: ManagedAgentOwner,
    id: string,
  ): Promise<EnvironmentVersion | null>;
  countPublished(owner: ManagedAgentOwner): Promise<number>;
}
