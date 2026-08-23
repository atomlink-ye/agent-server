import { randomUUID } from 'node:crypto';

import type { IssueRuntimeToolGrant } from '../ports/issue-runtime-tool-grant.js';
import type {
  EnsureRuntimeSession,
  ReadyRuntime,
} from '../ports/ensure-runtime-session.js';
import type {
  ExecutionAppliedSessionSpec,
  ExecutionPlanePort,
  ExecutionSessionSpec,
} from '../ports/execution-plane.js';
import type {
  RuntimeGenerationStore,
  RuntimeGenerationTransaction,
} from '../ports/runtime-generation-store.js';
import type { RuntimeSessionStore } from '../ports/runtime-session-store.js';
import type { RuntimeSpecStore } from '../ports/runtime-spec-store.js';
import type { RuntimeSessionGeneration } from '../../domain/runtime/runtime-session-generation.js';
import type {
  RuntimeGenerationId,
  RuntimeSessionId,
} from '../../domain/runtime/runtime-session.js';
import { buildReconciliationPlan } from './reconciliation/build-reconciliation-plan.js';
import type { Logger } from '../../shared/observability/logger.js';

/** Production reconciliation use case for one durable RuntimeSession. */
export class EnsureRuntimeSessionService implements EnsureRuntimeSession {
  public constructor(
    private readonly provider: ExecutionPlanePort,
    private readonly sessions: RuntimeSessionStore,
    private readonly specs: RuntimeSpecStore,
    private readonly generations: RuntimeGenerationStore,
    private readonly generationTransaction: RuntimeGenerationTransaction,
    private readonly grants: IssueRuntimeToolGrant,
    private readonly logger?: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async execute(sessionId: RuntimeSessionId): Promise<ReadyRuntime> {
    const session = await this.sessions.findById(sessionId);
    if (!session) throw new Error('runtime_session_not_found');
    if (session.status === 'closed') throw new Error('runtime_session_closed');

    const desired = await this.specs.getDesired(session).catch(() => {
      throw new Error('runtime_spec_not_found');
    });
    const current = await this.generations.findCurrent(sessionId);
    if (current && current.status !== 'active')
      throw new Error('runtime_provider_session_missing');

    const applied = current
      ? await this.specs.get(sessionId, current.appliedSpecRevision)
      : desired;
    if (!applied) throw new Error('runtime_spec_not_found');

    const plan = buildReconciliationPlan({
      applied,
      desired,
      generation: current,
      providerCapabilities: {
        canReconfigure: this.provider
          .capabilities()
          .supported.has('reusable_session'),
      },
    });

    if (plan.kind === 'fail') throw new Error('runtime_provider_unavailable');
    if (plan.kind === 'reuse' || plan.kind === 'reconfigure') {
      if (!current) throw new Error('runtime_provider_session_missing');
      const attached = await this.attach(current, desired);
      if (plan.kind === 'reconfigure')
        await this.generations.updateAppliedSpec({
          id: current.id,
          appliedSpecRevision: desired.revision,
          appliedBootstrapDigest: desired.bootstrapDigest,
        });
      return {
        generation: this.activeGeneration(current, desired),
        session: attached,
      };
    }

    return this.provision({
      sessionId,
      desired,
      previous: current,
    });
  }

  private async attach(
    generation: RuntimeSessionGeneration,
    desired: Awaited<ReturnType<RuntimeSpecStore['getDesired']>>,
  ) {
    const binding = this.binding(generation);
    const outcome = await this.provider.attachSession(
      binding.session,
      this.providerSpec(desired, binding.workspace),
      this.appliedSpec(generation),
    );
    if (outcome.kind === 'replacement_required')
      throw new Error('runtime_replacement_required');
    return outcome.session;
  }

  private async provision(input: {
    readonly sessionId: RuntimeSessionId;
    readonly desired: Awaited<ReturnType<RuntimeSpecStore['getDesired']>>;
    readonly previous: RuntimeSessionGeneration | null;
  }): Promise<ReadyRuntime> {
    const now = this.now().toISOString();
    const generationId = randomUUID() as RuntimeGenerationId;
    const generation = Object.freeze({
      id: generationId,
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
      readyAt: null,
      supersededAt: null,
      closedAt: null,
    });
    await this.generations.insert(generation);

    let grantId:
      | Awaited<ReturnType<IssueRuntimeToolGrant['issue']>>['grantId']
      | undefined;
    let created:
      Awaited<ReturnType<ExecutionPlanePort['createSession']>> | undefined;
    try {
      grantId = (
        await this.grants.issue({
          runtimeSessionId: input.sessionId,
          generationId,
          catalogDigest: input.desired.toolCatalogDigest,
        })
      ).grantId;
      created = await this.provider.createSession(
        this.providerSpec(input.desired, null, grantId),
      );
      if (!created.workspaceBinding.externalWorkspaceId)
        throw new Error('runtime_provider_session_missing');

      await this.generationTransaction.replaceCurrentGeneration({
        sessionId: input.sessionId,
        previousGenerationId: input.previous?.id ?? null,
        generation: {
          id: generationId,
          provider: input.desired.provider,
          providerWorkspaceId: created.workspaceBinding.externalWorkspaceId,
          providerSessionId: created.sessionBinding.externalSessionId,
          appliedSpecRevision: input.desired.revision,
          appliedBootstrapDigest: input.desired.bootstrapDigest,
          endpointEpoch: input.desired.extensionSetDigest,
          createdAt: now,
          readyAt: this.now().toISOString(),
        },
      });
    } catch (error) {
      await created?.session.close().catch(() => undefined);
      if (grantId) await this.grants.revoke(grantId).catch(() => undefined);
      await this.generations
        .failProvisioning({
          id: generationId,
          failedAt: this.now().toISOString(),
        })
        .catch(() => undefined);
      throw error;
    }

    if (input.previous) {
      this.logger?.log('warn', 'runtime.provider_session.orphaned', {
        runtime_session_id: input.sessionId,
        previous_generation_id: input.previous.id,
        previous_provider_session_id: input.previous.providerSessionId,
        reason: 'replacement_without_per_agent_close_support',
      });
    }
    await this.sessions.markStatus(
      input.sessionId,
      'ready',
      this.now().toISOString(),
    );
    const active = Object.freeze({
      ...generation,
      providerWorkspaceId: created!.workspaceBinding.externalWorkspaceId,
      providerSessionId: created!.sessionBinding.externalSessionId,
      status: 'active' as const,
      readyAt: this.now().toISOString(),
    });
    return { generation: active, session: created!.session };
  }

  private providerSpec(
    spec: Awaited<ReturnType<RuntimeSpecStore['getDesired']>>,
    workspace: { plane: string; externalWorkspaceId: string } | null,
    grantId?: string,
  ): ExecutionSessionSpec {
    return {
      runtimeSessionId: spec.runtimeSessionId,
      workspace: {
        cwd: spec.cwd,
        ...(workspace ? { binding: workspace } : {}),
      },
      provider: spec.provider,
      ...(spec.model ? { model: spec.model } : {}),
      systemPrompt: spec.systemPromptDigest,
      desiredRevision: spec.revision,
      bootstrapSpecDigest: spec.bootstrapDigest,
      endpointEpoch: spec.extensionSetDigest,
      ...(grantId ? { extensions: { grantId } } : {}),
    };
  }

  private appliedSpec(
    generation: RuntimeSessionGeneration,
  ): ExecutionAppliedSessionSpec {
    return {
      appliedRevision: generation.appliedSpecRevision,
      appliedSpecDigest: generation.appliedBootstrapDigest,
      endpointEpoch: generation.endpointEpoch,
    };
  }

  private binding(generation: RuntimeSessionGeneration): {
    readonly workspace: { plane: string; externalWorkspaceId: string };
    readonly session: { plane: string; externalSessionId: string };
  } {
    if (!generation.providerWorkspaceId || !generation.providerSessionId)
      throw new Error('runtime_provider_session_missing');
    return {
      workspace: {
        plane: generation.provider,
        externalWorkspaceId: generation.providerWorkspaceId,
      },
      session: {
        plane: generation.provider,
        externalSessionId: generation.providerSessionId,
      },
    };
  }

  private activeGeneration(
    generation: RuntimeSessionGeneration,
    desired: Awaited<ReturnType<RuntimeSpecStore['getDesired']>>,
  ): RuntimeSessionGeneration {
    return Object.freeze({
      ...generation,
      appliedSpecRevision: desired.revision,
      appliedBootstrapDigest: desired.bootstrapDigest,
      status: 'active' as const,
    });
  }
}
