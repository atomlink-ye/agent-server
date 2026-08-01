import type { Sha256Fingerprint } from './project-canonicalization.js';

export interface AgentProjectLock {
  readonly apiVersion: 'agent-server/v1alpha1';
  readonly kind: 'AgentProjectLock';
  readonly project: {
    readonly name: string;
    readonly fingerprint: Sha256Fingerprint;
  };
  readonly workspace: {
    readonly ref: string;
    readonly id: string;
    readonly name: string;
  };
  readonly toolProfiles: readonly {
    readonly ref: string;
    readonly sourceFingerprint: Sha256Fingerprint;
    readonly tools: readonly string[];
  }[];
  readonly skills: readonly {
    readonly ref: string;
    readonly catalogRef: string;
    readonly digest: string;
    readonly requiredTools: readonly string[];
  }[];
  readonly environments: readonly ResourceLock[];
  readonly agents: readonly ResourceLock[];
  readonly teams: readonly ResourceLock[];
  readonly memoryStores: readonly {
    readonly ref: string;
    readonly id: string;
    readonly name: string;
    readonly seeds: readonly {
      readonly path: string;
      readonly contentSha256: string;
      readonly memoryId: string;
      readonly memoryVersionId: string;
    }[];
  }[];
  readonly entrypoints: readonly {
    readonly ref: string;
    readonly teamVersionId: string;
  }[];
}

export interface ResourceLock {
  readonly ref: string;
  readonly sourceFingerprint: Sha256Fingerprint;
  readonly appliedFingerprint: Sha256Fingerprint;
  readonly definitionId: string;
  readonly versionId: string;
}
