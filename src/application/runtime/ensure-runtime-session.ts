import { randomUUID } from 'node:crypto';

import type { IssueRuntimeToolGrant } from '../ports/issue-runtime-tool-grant.js';
import { AGENT_SERVER_EXECUTION_MCP_SERVER_NAME } from '../ports/execution-plane.js';
import type {
  EnsureRuntimeSession,
  ReadyRuntime,
} from '../ports/ensure-runtime-session.js';
import type {
  ProviderRuntimeSpec,
  ProviderSessionBinding,
  RuntimeExecutionProvider,
} from '../ports/runtime-execution-provider.js';
import type {
  RuntimeGenerationStore,
  RuntimeGenerationTransaction,
} from '../ports/runtime-generation-store.js';
import type { RuntimeSessionStore } from '../ports/runtime-session-store.js';
import type { RuntimeMcpEndpoint } from '../ports/runtime-mcp-endpoint.js';
import type { RuntimeSpecStore } from '../ports/runtime-spec-store.js';
import type { RuntimeSessionGeneration } from '../../domain/runtime/runtime-session-generation.js';
import { computeRuntimeBootstrapDigest } from '../../domain/runtime/runtime-session-spec.js';
import type {
  RuntimeGenerationId,
  RuntimeSessionId,
} from '../../domain/runtime/runtime-session.js';
import { buildReconciliationPlan } from './reconciliation/build-reconciliation-plan.js';
import type { Logger } from '../../shared/observability/logger.js';

/** Production reconciliation use case for one durable RuntimeSession. */
export class EnsureRuntimeSessionService implements EnsureRuntimeSession {
  public constructor(
    private readonly provider: RuntimeExecutionProvider,
    private readonly sessions: RuntimeSessionStore,
    private readonly specs: RuntimeSpecStore,
    private readonly generations: RuntimeGenerationStore,
    private readonly generationTransaction: RuntimeGenerationTransaction,
    private readonly grants: IssueRuntimeToolGrant,
    private readonly mcpEndpoint: RuntimeMcpEndpoint,
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
      providerCapabilities: this.provider.capabilities(),
    });
    if (plan.kind === 'fail') throw new Error('runtime_provider_unavailable');

    const effectivePlan = current
      ? await this.planAfterInspection({ current, applied, plan })
      : plan;

    if (effectivePlan.kind === 'reuse') {
      if (!current) throw new Error('runtime_provider_session_missing');
      return {
        generation: current,
        session: await this.provider.open(this.binding(current, applied)),
        resolution: 'reused',
      };
    }

    if (effectivePlan.kind === 'reconfigure') {
      if (!current) throw new Error('runtime_provider_session_missing');
      const handle = await this.provider.reconfigure(
        this.binding(current, applied),
        this.providerSpec(desired),
      );
      await this.generations.updateAppliedSpec({
        id: current.id,
        appliedSpecRevision: desired.revision,
        appliedBootstrapDigest: desired.bootstrapDigest,
      });
      return {
        generation: this.activeGeneration(current, desired),
        session: handle.session,
        resolution: 'reconfigured',
      };
    }

    return this.provision({
      session,
      desired,
      previous: current,
      previousApplied: applied,
    });
  }

  private async provision(input: {
    readonly session: Awaited<ReturnType<RuntimeSessionStore['findById']>>;
    readonly desired: Awaited<ReturnType<RuntimeSpecStore['getDesired']>>;
    readonly previous: RuntimeSessionGeneration | null;
    readonly previousApplied: Awaited<ReturnType<RuntimeSpecStore['getDesired']>> | null;
  }): Promise<ReadyRuntime> {
    if (!input.session) throw new Error('runtime_session_not_found');
    const now = this.now().toISOString();
    const generationId = randomUUID() as RuntimeGenerationId;
    const generation = Object.freeze({
      id: generationId,
      runtimeSessionId: input.session.id,
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

    let grantId: Awaited<ReturnType<IssueRuntimeToolGrant['issue']>>['grantId'] | undefined;
    let created: Awaited<ReturnType<RuntimeExecutionProvider['create']>> | undefined;
    try {
      const grant = await this.grants.issue({
        runtimeSessionId: input.session.id,
        generationId,
        tenantId: input.session.owner.tenantId,
        principal: {
          principalType: input.session.owner.principalType,
          principalId: input.session.owner.principalId,
        },
        scope: input.session.scope,
        catalogDigest: input.desired.toolCatalogDigest,
        allowedTools: input.desired.toolRefs,
      });
      grantId = grant.grantId;
      const endpoint = await this.mcpEndpoint.current();
      created = await this.provider.create(
        this.providerSpec(input.desired, {
          url: endpoint.url,
          token: grant.token,
        }),
      );
      if (!created.providerWorkspaceId || !created.providerSessionId)
        throw new Error('runtime_provider_session_missing');

      await this.generationTransaction.replaceCurrentGeneration({
        sessionId: input.session.id,
        previousGenerationId: input.previous?.id ?? null,
        generation: {
          id: generationId,
          provider: created.provider,
          providerWorkspaceId: created.providerWorkspaceId,
          providerSessionId: created.providerSessionId,
          appliedSpecRevision: input.desired.revision,
          appliedBootstrapDigest: input.desired.bootstrapDigest,
          endpointEpoch: input.desired.extensionSetDigest,
          createdAt: now,
          activeAt: this.now().toISOString(),
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

    if (input.previous)
      await this.closeOrRecordOrphan(
        input.previous,
        input.previousApplied,
        generation,
      );
    await this.sessions.markStatus(input.session.id, 'ready', this.now().toISOString());
    const active = Object.freeze({
      ...generation,
      provider: created!.provider,
      providerWorkspaceId: created!.providerWorkspaceId,
      providerSessionId: created!.providerSessionId,
      status: 'active' as const,
      activeAt: this.now().toISOString(),
    });
    return {
      generation: active,
      session: created!.session,
      resolution: 'replaced',
    };
  }

  private async planAfterInspection(input: {
    readonly current: RuntimeSessionGeneration;
    readonly applied: Awaited<ReturnType<RuntimeSpecStore['getDesired']>>;
    readonly plan: ReturnType<typeof buildReconciliationPlan>;
  }): Promise<ReturnType<typeof buildReconciliationPlan>> {
    const inspection = await this.provider.inspect(
      this.binding(input.current, input.applied),
    );
    if (inspection.status === 'unavailable')
      throw new Error('runtime_provider_unavailable');
    if (inspection.status === 'missing' || inspection.status === 'stale')
      return {
        kind: 'replace',
        generationId: input.current.id,
        reason: 'provider_missing',
      };
    const components = inspection.observed.bootstrapDigestComponents;
    if (components.status === 'indeterminate')
      throw new Error('runtime_provider_bootstrap_digest_indeterminate');
    if (
      inspection.observed.providerSessionId !== input.current.providerSessionId ||
      computeRuntimeBootstrapDigest(components.value) !==
        input.current.appliedBootstrapDigest
    )
      return {
        kind: 'replace',
        generationId: input.current.id,
        reason: 'provider_missing',
      };
    return input.plan;
  }

  private async closeOrRecordOrphan(
    previous: RuntimeSessionGeneration,
    previousApplied: Awaited<ReturnType<RuntimeSpecStore['getDesired']>> | null,
    replacement: RuntimeSessionGeneration,
  ): Promise<void> {
    if (!previousApplied) throw new Error('runtime_spec_not_found');
    const binding = this.binding(previous, previousApplied);
    if (this.provider.capabilities().canCloseSession) {
      try {
        await this.provider.close(binding);
        return;
      } catch {
        // The switch is already durable; report the provider orphan below.
      }
    }
    this.logger?.log('warn', 'runtime.provider.orphan_session', {
      previous_generation_id: previous.id,
      replacement_generation_id: replacement.id,
      provider: previous.provider,
      provider_session_id: previous.providerSessionId,
      reason: 'replacement_without_per_agent_close_support',
    });
  }

  private providerSpec(
    spec: Awaited<ReturnType<RuntimeSpecStore['getDesired']>>,
    grant?: { readonly url: string; readonly token: string },
  ): ProviderRuntimeSpec {
    return {
      runtimeSessionId: spec.runtimeSessionId,
      provider: spec.provider,
      model: spec.model,
      cwd: spec.cwd,
      systemPrompt: spec.systemPromptDigest,
      workspaceId: spec.workspaceId,
      revision: spec.revision,
      desiredRevision: spec.revision,
      bootstrapSpecDigest: spec.bootstrapDigest,
      endpointEpoch: spec.extensionSetDigest,
      ...(grant
        ? {
            extensions: {
              mcpServers: [
                {
                  name: AGENT_SERVER_EXECUTION_MCP_SERVER_NAME,
                  url: grant.url,
                  headers: { Authorization: `Bearer ${grant.token}` },
                },
              ],
            },
          }
        : {}),
    };
  }

  private binding(
    generation: RuntimeSessionGeneration,
    applied: Awaited<ReturnType<RuntimeSpecStore['getDesired']>>,
  ): ProviderSessionBinding {
    if (!generation.providerWorkspaceId || !generation.providerSessionId)
      throw new Error('runtime_provider_session_missing');
    return {
      generation: {
        id: generation.id,
        runtimeSessionId: generation.runtimeSessionId,
        provider: generation.provider,
        providerWorkspaceId: generation.providerWorkspaceId,
        providerSessionId: generation.providerSessionId,
        appliedSpecRevision: generation.appliedSpecRevision,
      },
      applied: this.providerSpec(applied) as ProviderSessionBinding['applied'],
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
