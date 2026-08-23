import type { IssueRuntimeToolGrant } from '../ports/issue-runtime-tool-grant.js';
import { AGENT_SERVER_EXECUTION_MCP_SERVER_NAME } from '../ports/runtime-extension-binding.js';
import type {
  EnsureRuntimeSession,
  ReadyRuntime,
} from '../ports/ensure-runtime-session.js';
import type {
  ProviderRuntimeSpec,
  ProviderSessionBinding,
  RuntimeExecutionProvider,
} from '../ports/runtime-execution-provider.js';
import type { RuntimeGenerationStore } from '../ports/runtime-generation-store.js';
import type { RuntimeSessionStore } from '../ports/runtime-session-store.js';
import type { RuntimeMcpEndpoint } from '../ports/runtime-mcp-endpoint.js';
import type { RuntimeSpecStore } from '../ports/runtime-spec-store.js';
import type { RuntimeSessionGeneration } from '../../domain/runtime/runtime-session-generation.js';
import { computeRuntimeBootstrapDigest } from '../../domain/runtime/runtime-session-spec.js';
import type { RuntimeSessionId } from '../../domain/runtime/runtime-session.js';
import { buildReconciliationPlan } from './reconciliation/build-reconciliation-plan.js';
import type { Logger } from '../../shared/observability/logger.js';
import { RuntimeGenerationManager } from './runtime-generation-manager.js';

export interface EnsureRuntimeSessionServiceOptions {
  readonly provider: RuntimeExecutionProvider;
  readonly sessions: RuntimeSessionStore;
  readonly specs: RuntimeSpecStore;
  readonly generations: RuntimeGenerationStore;
  readonly generationManager: RuntimeGenerationManager;
  readonly grants: IssueRuntimeToolGrant;
  readonly mcpEndpoint: RuntimeMcpEndpoint;
  readonly logger: Logger;
  readonly now: () => Date;
}

/** Production reconciliation use case for one durable RuntimeSession. */
export class EnsureRuntimeSessionService implements EnsureRuntimeSession {
  private readonly provider: RuntimeExecutionProvider;
  private readonly sessions: RuntimeSessionStore;
  private readonly specs: RuntimeSpecStore;
  private readonly generations: RuntimeGenerationStore;
  private readonly generationManager: RuntimeGenerationManager;
  private readonly grants: IssueRuntimeToolGrant;
  private readonly mcpEndpoint: RuntimeMcpEndpoint;
  private readonly logger: Logger;
  private readonly now: () => Date;

  public constructor(options: EnsureRuntimeSessionServiceOptions) {
    this.provider = options.provider;
    this.sessions = options.sessions;
    this.specs = options.specs;
    this.generations = options.generations;
    this.generationManager = options.generationManager;
    this.grants = options.grants;
    this.mcpEndpoint = options.mcpEndpoint;
    this.logger = options.logger;
    this.now = options.now;
  }

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
      // DECISION-007: RuntimeGenerationManager.reconfigure is deferred;
      // do not mutate durable spec state or invoke provider reconfigure here.
      throw new Error('runtime_reconfigure_deferred');
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
    readonly previousApplied: Awaited<
      ReturnType<RuntimeSpecStore['getDesired']>
    > | null;
  }): Promise<ReadyRuntime> {
    if (!input.session) throw new Error('runtime_session_not_found');
    const generation = await this.generationManager.beginReplacement({
      sessionId: input.session.id,
      previous: input.previous,
      desired: input.desired,
    });

    let grantId:
      | Awaited<ReturnType<IssueRuntimeToolGrant['issue']>>['grantId']
      | undefined;
    let created:
      Awaited<ReturnType<RuntimeExecutionProvider['create']>> | undefined;
    let active: RuntimeSessionGeneration | undefined;
    try {
      const grant = await this.grants.issue({
        runtimeSessionId: input.session.id,
        generationId: generation.id,
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

      active = await this.generationManager.activateReplacement({
        generationId: generation.id,
        expectedPreviousGenerationId: input.previous?.id ?? null,
        providerWorkspaceId: created.providerWorkspaceId,
        providerSessionId: created.providerSessionId,
      });
    } catch (error) {
      await created?.session.close().catch(() => undefined);
      if (grantId) await this.grants.revoke(grantId).catch(() => undefined);
      await this.generationManager
        .failProvisioning(generation.id)
        .catch(() => undefined);
      throw error;
    }

    if (input.previous)
      await this.closeOrRecordOrphan(
        input.previous,
        input.previousApplied,
        active!,
      );
    return {
      generation: active!,
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
    if (inspection.status !== 'available') {
      if (inspection.status === 'unavailable')
        throw new Error('runtime_provider_unavailable');
      return {
        kind: 'replace',
        generationId: input.current.id,
        reason: 'provider_missing',
      };
    }
    const components = inspection.observed.bootstrapDigestComponents;
    if (components.status === 'indeterminate')
      throw new Error('runtime_provider_bootstrap_digest_indeterminate');
    if (
      inspection.observed.providerSessionId !==
        input.current.providerSessionId ||
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
        await this.provider.closeSession(binding);
        await this.generationManager.close(previous.id);
        return;
      } catch {
        // The switch is already durable; report the provider orphan below.
      }
    }
    this.logger.log('warn', 'runtime.provider.orphan_session', {
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
}
