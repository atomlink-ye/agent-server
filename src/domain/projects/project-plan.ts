import type { Sha256Fingerprint } from './project-canonicalization.js';

export type ProjectPlanSection =
  | 'Workspace'
  | 'ToolProfiles'
  | 'Skills'
  | 'Environments'
  | 'Workers'
  | 'Teams'
  | 'MemoryStores'
  | 'MemorySeeds'
  | 'Entrypoints';
export type ProjectPlanAction =
  | 'resolve-workspace'
  | 'validate-tool-profile'
  | 'register-skill'
  | 'import/publish-environment'
  | 'import/publish-worker'
  | 'import/publish-team'
  | 'ensure-memory-store'
  | 'ensure-memory-seed'
  | 'bind-entrypoint';
export interface ProjectPlanStep {
  readonly section: ProjectPlanSection;
  readonly name: string;
  readonly action: ProjectPlanAction;
  readonly dependencies: readonly string[];
  readonly sourceFingerprint?: Sha256Fingerprint;
  readonly appliedFingerprint?: Sha256Fingerprint;
  readonly validationFingerprint?: Sha256Fingerprint;
  readonly metadata?: Readonly<Record<string, string>>;
}
export interface ProjectPlan {
  readonly apiVersion: 'agent-server/v1alpha1';
  readonly kind: 'ProjectPlan';
  readonly projectName: string;
  readonly projectFingerprint: Sha256Fingerprint;
  readonly workspace: 'workspace://default';
  readonly steps: readonly ProjectPlanStep[];
}
