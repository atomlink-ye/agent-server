import type { IssueRuntimeToolGrant } from '../ports/issue-runtime-tool-grant.js';
import { AGENT_SERVER_EXECUTION_MCP_SERVER_NAME } from '../ports/runtime-extension-binding.js';
import type {
  EnsureRuntimeSession,
  ReadyRuntime,
} from '../ports/ensure-runtime-session.js';
import type {
  ProviderRuntimeSpec,
  RuntimeExecutionProvider,
} from '../ports/runtime-execution-provider.js';
import type { RuntimeGenerationStore } from '../ports/runtime-generation-store.js';
import type { RuntimeSessionStore } from '../ports/runtime-session-store.js';
import type { RuntimeMcpEndpoint } from '../ports/runtime-mcp-endpoint.js';
import type { RuntimeSpecStore } from '../ports/runtime-spec-store.js';
import type { RuntimeSessionGeneration } from '../../domain/runtime/runtime-session-generation.js';
import { computeRuntimeBootstrapDigest } from '../../domain/runtime/runtime-session-spec.js';
import type { RuntimeSessionId } from '../../domain/runtime/runtime-session.js';
import type { DesiredRuntimeSystemPrompt } from '../../domain/runtime/desired-runtime-system-prompt.js';
import { assertDesiredRuntimeSystemPrompt } from '../../domain/runtime/desired-runtime-system-prompt.js';
import { buildReconciliationPlan } from './reconciliation/build-reconciliation-plan.js';
import type { ReconciliationPlan } from '../../domain/runtime/reconciliation-plan.js';
import type { Logger } from '../../shared/observability/logger.js';
import type { RuntimeGenerationManager } from './runtime-generation-manager.js';
import { buildProviderSessionBinding } from './provider-session-binding.js';

export function planWhenBootstrapDigestIsIndeterminate(input: {
  readonly plan: ReconciliationPlan;
  readonly canInspectBootstrapDigestComponents: boolean;
}): ReconciliationPlan {
  if (
    input.plan.kind !== 'replace' &&
    input.canInspectBootstrapDigestComponents
  )
    throw new Error('runtime_provider_bootstrap_digest_indeterminate');
  return input.plan;
}

function isWorkChatScope(scopeKind: string): boolean {
  return scopeKind === 'work_chat' || scopeKind === 'work_run_chat';
}

/** Work Chat always re-provisions so provider-native tools cannot survive reuse. */
export function forceWorkChatReplacement(input: {
  readonly scopeKind: string;
  readonly plan: ReconciliationPlan;
}): ReconciliationPlan {
  if (!isWorkChatScope(input.scopeKind) || input.plan.kind !== 'reuse')
    return input.plan;
  return {
    kind: 'replace',
    generationId: input.plan.generationId,
    reason: 'immutable_spec_changed',
  };
}

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

  public async execute(
    sessionId: RuntimeSessionId,
    desiredSystemPrompt: DesiredRuntimeSystemPrompt,
  ): Promise<ReadyRuntime> {
    assertDesiredRuntimeSystemPrompt(desiredSystemPrompt);
    const session = await this.sessions.findById(sessionId);
    if (!session) throw new Error('runtime_session_not_found');
    if (session.status === 'closed') throw new Error('runtime_session_closed');

    const desired = await this.specs.getDesired(session).catch(() => {
      throw new Error('runtime_spec_not_found');
    });
    if (desired.systemPromptDigest !== desiredSystemPrompt.digest)
      throw new Error('runtime_system_prompt_digest_mismatch');
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

    const reconciledPlan = current
      ? await this.planAfterInspection({
          current,
          applied,
          plan,
          desiredSystemPrompt,
        })
      : plan;
    const effectivePlan = forceWorkChatReplacement({
      scopeKind: session.scope.kind,
      plan: reconciledPlan,
    });

    if (effectivePlan.kind === 'reuse') {
      if (!current) throw new Error('runtime_provider_session_missing');
      // A reused provider session keeps the MCP endpoint it was bootstrapped
      // with. That endpoint is a live listener owned by this process, so it
      // must be up before the turn runs; otherwise the provider resumes
      // against a dead URL and the Agent silently loses every granted tool.
      await this.mcpEndpoint.current();
      return {
        generation: current,
        session: await this.provider.open(
          buildProviderSessionBinding(current, applied),
          this.providerSpec(
            applied,
            desiredSystemPrompt,
            undefined,
            isWorkChatScope(session.scope.kind)
              ? { nativeTools: 'disabled' }
              : undefined,
          ),
        ),
        resolution: 'reused',
      };
    }

    if (effectivePlan.kind === 'reconfigure') {
      if (!current) throw new Error('runtime_provider_session_missing');
      // DECISION-007: RuntimeGenerationManager.reconfigure is deferred;
      // do not mutate durable spec state or invoke provider reconfigure here.
      throw new Error('runtime_reconfigure_deferred');
    }

    // Only the provider-missing/stale replace path earns this log: an
    // ordinary spec-driven replace (provider/model/cwd change, etc.) is
    // expected reconciliation, not a self-heal, and logging it here would
    // make this line meaningless noise.
    if (
      current &&
      effectivePlan.kind === 'replace' &&
      effectivePlan.reason === 'provider_missing'
    )
      this.logger.log('info', 'runtime.provider.session_reset', {
        runtime_session_id: session.id,
        runtime_generation_id: current.id,
        provider: current.provider,
        provider_session_id: current.providerSessionId,
        reason:
          'Paseo reported the provider session missing or stale; starting a fresh engine session and replaying persisted history so no messages are lost.',
      });

    return this.provision({
      session,
      desired,
      previous: current,
      previousApplied: applied,
      desiredSystemPrompt,
    });
  }

  private async provision(input: {
    readonly session: Awaited<ReturnType<RuntimeSessionStore['findById']>>;
    readonly desired: Awaited<ReturnType<RuntimeSpecStore['getDesired']>>;
    readonly previous: RuntimeSessionGeneration | null;
    readonly previousApplied: Awaited<
      ReturnType<RuntimeSpecStore['getDesired']>
    > | null;
    readonly desiredSystemPrompt: DesiredRuntimeSystemPrompt;
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
        this.providerSpec(
          input.desired,
          input.desiredSystemPrompt,
          {
            url: endpoint.url,
            token: grant.token,
          },
          isWorkChatScope(input.session.scope.kind)
            ? { nativeTools: 'disabled' }
            : undefined,
        ),
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
      this.logger.log('error', 'runtime.provisioning.failed', {
        runtime_session_id: input.session.id,
        runtime_generation_id: generation.id,
        desired_revision: input.desired.revision,
        provider: input.desired.provider,
        ...(input.desired.model ? { model: input.desired.model } : {}),
        agent_version_id: input.desired.agentVersionId,
        environment_version_id: input.desired.environmentVersionId,
        scope_kind: input.session.scope.kind,
        scope_id: input.session.scope.id,
        provider_workspace_id: created?.providerWorkspaceId ?? null,
        provider_session_id: created?.providerSessionId ?? null,
        failure_class: error instanceof Error ? error.name : 'UnknownError',
      });
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
        input.desiredSystemPrompt,
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
    readonly desiredSystemPrompt: DesiredRuntimeSystemPrompt;
  }): Promise<ReturnType<typeof buildReconciliationPlan>> {
    const inspection = await this.provider.inspect(
      buildProviderSessionBinding(input.current, input.applied),
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
      return planWhenBootstrapDigestIsIndeterminate({
        plan: input.plan,
        canInspectBootstrapDigestComponents:
          this.provider.capabilities().canInspectBootstrapDigestComponents,
      });
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
    desiredSystemPrompt: DesiredRuntimeSystemPrompt,
  ): Promise<void> {
    if (!previousApplied) throw new Error('runtime_spec_not_found');
    if (previousApplied.systemPromptDigest !== desiredSystemPrompt.digest) {
      this.logger.log('warn', 'runtime.provider.orphan_session', {
        previous_generation_id: previous.id,
        replacement_generation_id: replacement.id,
        provider: previous.provider,
        provider_session_id: previous.providerSessionId,
        reason: 'previous_prompt_text_not_available_at_provider-close-boundary',
      });
      return;
    }
    const binding = buildProviderSessionBinding(previous, previousApplied);
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
    desiredSystemPrompt: DesiredRuntimeSystemPrompt,
    grant?: { readonly url: string; readonly token: string },
    policy?: { readonly nativeTools?: 'disabled' },
  ): ProviderRuntimeSpec {
    return {
      runtimeSessionId: spec.runtimeSessionId,
      provider: spec.provider,
      model: spec.model,
      cwd: spec.cwd,
      systemPrompt: desiredSystemPrompt.text,
      workspaceId: spec.workspaceId,
      revision: spec.revision,
      desiredRevision: spec.revision,
      bootstrapSpecDigest: spec.bootstrapDigest,
      endpointEpoch: spec.extensionSetDigest,
      ...(policy?.nativeTools ? { nativeTools: policy.nativeTools } : {}),
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
}
