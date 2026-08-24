import { randomUUID } from 'node:crypto';

import type {
  RuntimeGenerationStore,
  RuntimeGenerationTransaction,
} from '../ports/runtime-generation-store.js';
import type { RuntimeSessionGeneration } from '../../domain/runtime/runtime-session-generation.js';
import type {
  RuntimeGenerationId,
  RuntimeSessionId,
} from '../../domain/runtime/runtime-session.js';
import type { RuntimeSessionSpec } from '../../domain/runtime/runtime-session-spec.js';
import type { RevokeRuntimeGrants } from '../ports/revoke-runtime-grants.js';

export interface BeginRuntimeGenerationReplacementInput {
  readonly sessionId: RuntimeSessionId;
  readonly previous: RuntimeSessionGeneration | null;
  readonly desired: RuntimeSessionSpec;
}

export interface ActivateRuntimeGenerationReplacementInput {
  readonly generationId: RuntimeGenerationId;
  readonly expectedPreviousGenerationId: RuntimeGenerationId | null;
  readonly providerWorkspaceId: string;
  readonly providerSessionId: string;
}

export interface RuntimeGenerationManagerOptions {
  readonly generations: RuntimeGenerationStore;
  readonly generationTransaction: RuntimeGenerationTransaction;
  readonly grants: RevokeRuntimeGrants;
  readonly now: () => Date;
}

/** Owns durable RuntimeSession generation transitions, not provider execution. */
export class RuntimeGenerationManager {
  private readonly generations: RuntimeGenerationStore;
  private readonly generationTransaction: RuntimeGenerationTransaction;
  private readonly grants: RevokeRuntimeGrants;
  private readonly now: () => Date;

  public constructor(options: RuntimeGenerationManagerOptions) {
    this.generations = options.generations;
    this.generationTransaction = options.generationTransaction;
    this.grants = options.grants;
    this.now = options.now;
  }

  public async beginReplacement(
    input: BeginRuntimeGenerationReplacementInput,
  ): Promise<RuntimeSessionGeneration> {
    const now = this.now().toISOString();
    const generation = Object.freeze({
      id: randomUUID() as RuntimeGenerationId,
      runtimeSessionId: input.sessionId,
      generation: (input.previous?.generation ?? 0) + 1,
      provider: input.desired.provider,
      providerWorkspaceId: null,
      providerSessionId: null,
      appliedSpecRevision: input.desired.revision,
      appliedBootstrapDigest: input.desired.bootstrapDigest,
      endpointEpoch: input.desired.extensionSetDigest,
      status: 'provisioning' as const,
      createdAt: now,
      activeAt: null,
      supersededAt: null,
      closedAt: null,
    });
    await this.generations.insert(generation);
    return generation;
  }

  public async activateReplacement(
    input: ActivateRuntimeGenerationReplacementInput,
  ): Promise<RuntimeSessionGeneration> {
    const provisioning = await this.generations.findById(input.generationId);
    if (!provisioning || provisioning.status !== 'provisioning')
      throw new Error('Provisioning runtime generation could not activate.');

    const activeAt = this.now().toISOString();
    const active = await this.generationTransaction.replaceCurrentGeneration({
      sessionId: provisioning.runtimeSessionId,
      previousGenerationId: input.expectedPreviousGenerationId,
      generation: {
        id: provisioning.id,
        provider: provisioning.provider,
        providerWorkspaceId: input.providerWorkspaceId,
        providerSessionId: input.providerSessionId,
        appliedSpecRevision: provisioning.appliedSpecRevision,
        appliedBootstrapDigest: provisioning.appliedBootstrapDigest,
        endpointEpoch: provisioning.endpointEpoch,
        createdAt: provisioning.createdAt,
        activeAt,
      },
    });
    if (input.expectedPreviousGenerationId)
      await this.grants.revokeForGeneration(input.expectedPreviousGenerationId);
    return active;
  }

  public async failProvisioning(
    generationId: RuntimeGenerationId,
  ): Promise<void> {
    await this.generations.failProvisioning({
      id: generationId,
      failedAt: this.now().toISOString(),
    });
  }

  public async close(generationId: RuntimeGenerationId): Promise<void> {
    const generation = await this.generations.findById(generationId);
    if (!generation) throw new Error('Runtime generation does not exist.');
    if (generation.status === 'closed') return;
    if (generation.status !== 'superseded')
      throw new Error('Only superseded runtime generations can close.');
    await this.grants.revokeForGeneration(generation.id);
    await this.generations.close({
      id: generation.id,
      closedAt: this.now().toISOString(),
      expectedStatus: 'superseded',
    });
  }
}
