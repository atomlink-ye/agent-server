import type { InvokableOwnerScope } from '../../domain/invokables/invokable.js';
import type { ResourceOwner } from '../../domain/tenancy/product-context.js';
import type { WorkerDefinition } from '../../domain/workers/worker-definition.js';
import type { WorkerOwner } from '../../domain/workers/worker-owner.js';
import type { WorkerVersion } from '../../domain/workers/worker-version.js';
import type { ModelPolicyRef } from '../../domain/agents/managed-agent-package.js';
import type { ResolvedSkillPackage } from '../extensions/skill-catalog.js';

export interface WorkerRegistry {
  importWorker(command: ImportWorkerAtomicCommand): Promise<ImportWorkerAtomicResult>;
  publishWorkerVersion(command: PublishWorkerAtomicCommand): Promise<WorkerVersion>;
  findDefinition(owner: WorkerOwner, definitionId: string): Promise<WorkerDefinition | null>;
  findVersion(owner: WorkerOwner, versionId: string): Promise<WorkerVersion | null>;
  findVersionByTenant(input: {
    readonly tenantId: string;
    readonly versionId: string;
  }): Promise<WorkerVersion | null>;
}

export interface ImportWorkerAtomicCommand {
  readonly owner: WorkerOwner;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly normalizedName: string;
  readonly definition: WorkerDefinition;
  readonly version: WorkerVersion;
}

export type ImportWorkerAtomicResult = Readonly<{
  kind: 'created' | 'converged' | 'replayed';
  definition: WorkerDefinition;
  version: WorkerVersion;
}>;

export interface PublishWorkerAtomicCommand {
  readonly owner: WorkerOwner;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly versionId: string;
}

export type WorkerVersionResolutionScope = InvokableOwnerScope;

export type ResolvedWorkerVersion = Readonly<{
  readonly source: 'worker';
  readonly id: string;
  readonly definitionId: string;
  readonly workerOwner: ResourceOwner;
  readonly instructions: string;
  readonly modelPolicyRef: ModelPolicyRef;
  readonly proposalLimit: number;
  readonly skills: readonly ResolvedSkillPackage[];
  readonly toolRefs: readonly string[];
}>;

export interface WorkerResolutionApi {
  resolvePublished(
    versionId: string,
    scope: WorkerVersionResolutionScope,
    options?: { readonly resolveExtensions?: boolean },
  ): Promise<ResolvedWorkerVersion | null>;
}
