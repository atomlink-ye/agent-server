import { describe, expect, it, vi } from 'vitest';

import {
  EnsureRuntimeSessionService,
  forceWorkChatReplacement,
  planWhenBootstrapDigestIsIndeterminate,
} from './ensure-runtime-session.js';
import { EnsureDesiredRuntimeSpecService } from './ensure-desired-runtime-spec.js';
import { createDesiredRuntimeSystemPrompt } from '../../domain/runtime/desired-runtime-system-prompt.js';
import { createRuntimeSessionSpec } from '../../domain/runtime/runtime-session-spec.js';
import {
  runtimeSpecRevision,
  type RuntimeSessionId,
} from '../../domain/runtime/runtime-session.js';
import type { ReconciliationPlan } from '../../domain/runtime/reconciliation-plan.js';
import type { RuntimeGenerationId } from '../../domain/runtime/runtime-session.js';

const generationId =
  '11111111-1111-4111-8111-111111111111' as RuntimeGenerationId;
const sessionId = '22222222-2222-4222-8222-222222222222' as RuntimeSessionId;

const reuse: ReconciliationPlan = { kind: 'reuse', generationId };
const replace: ReconciliationPlan = {
  kind: 'replace',
  generationId,
  reason: 'provider_missing',
};

describe('planWhenBootstrapDigestIsIndeterminate', () => {
  it('returns reuse when the provider cannot inspect bootstrap digest components', () => {
    expect(
      planWhenBootstrapDigestIsIndeterminate({
        plan: reuse,
        canInspectBootstrapDigestComponents: false,
      }),
    ).toEqual(reuse);
  });

  it('returns replace when the provider cannot inspect bootstrap digest components', () => {
    expect(
      planWhenBootstrapDigestIsIndeterminate({
        plan: replace,
        canInspectBootstrapDigestComponents: false,
      }),
    ).toEqual(replace);
  });

  it('throws when a digest-inspecting provider returns indeterminate on non-replace', () => {
    expect(() =>
      planWhenBootstrapDigestIsIndeterminate({
        plan: reuse,
        canInspectBootstrapDigestComponents: true,
      }),
    ).toThrow('runtime_provider_bootstrap_digest_indeterminate');
  });
});

describe('Work Chat native tool isolation', () => {
  it.each(['work_chat', 'work_run_chat'])(
    'forces reuse to replacement for %s scopes',
    (scopeKind) => {
      expect(forceWorkChatReplacement({ scopeKind, plan: reuse })).toEqual({
        kind: 'replace',
        generationId,
        reason: 'immutable_spec_changed',
      });
    },
  );

  it('leaves non-chat scopes unchanged', () => {
    expect(
      forceWorkChatReplacement({ scopeKind: 'team_member', plan: reuse }),
    ).toEqual(reuse);
    expect(forceWorkChatReplacement({ scopeKind: 'run', plan: reuse })).toEqual(
      reuse,
    );
  });
});

describe('EnsureRuntimeSessionService reuse path', () => {
  it('brings the MCP endpoint up before resuming a provider session', async () => {
    const harness = reuseHarness();

    const ready = await harness.service.execute(
      sessionId,
      harness.desiredSystemPrompt,
    );

    expect(ready.resolution).toBe('reused');
    // The resumed provider session still points at the endpoint it was
    // bootstrapped with. If that listener is not up, the Agent silently loses
    // every granted platform tool, so it must be started before the turn.
    expect(harness.endpointCalls).toBe(1);
    expect(harness.openedAfterEndpoint).toBe(true);
  });
});

describe('closed chat runtime session recovery', () => {
  it('creates a successor for a closed scope before a new turn reaches runtime readiness', async () => {
    const closed = runtimeSessionForClosedScope(sessionId, 'closed');
    const successorId =
      '44444444-4444-4444-8444-444444444444' as RuntimeSessionId;
    const successor = runtimeSessionForClosedScope(successorId, 'provisioning');
    const desiredSystemPrompt =
      createDesiredRuntimeSystemPrompt('stable prompt');
    const resolve = vi.fn((input) =>
      createRuntimeSessionSpec({
        runtimeSessionId:
          input.target.kind === 'initial'
            ? successorId
            : input.target.runtimeSessionId,
        revision:
          input.target.kind === 'initial'
            ? runtimeSpecRevision(1)
            : input.target.revision,
        workspaceId: closed.owner.workspaceId,
        agentVersionId: 'agent-version-1',
        environmentVersionId: null,
        resolvedSkills: [],
        toolRefs: [],
        provider: 'codex',
        model: null,
        cwd: '/runtime',
        systemPromptDigest: desiredSystemPrompt.digest,
        skillSetDigest: 'skills',
        toolCatalogDigest: 'catalog',
        extensionSetDigest: 'extensions',
        contextEpoch: 1,
        createdAt: '2026-09-09T00:00:00.000Z',
      }),
    );
    const createWithInitialSpec = vi.fn(async () => successor);
    const service = new EnsureDesiredRuntimeSpecService(
      {
        findByScope: vi.fn(async () => closed),
        findById: vi.fn(async () => successor),
        createWithInitialSpec,
      } as never,
      {
        getDesired: vi.fn(async () => resolve({ target: { kind: 'initial' } })),
      } as never,
      { execute: resolve },
    );

    const result = await service.execute({
      owner: closed.owner,
      scope: closed.scope,
      agentVersionId: 'agent-version-1',
      environmentVersionId: null,
      resolvedSkills: [],
      toolRefs: [],
      configuration: {
        provider: 'codex',
        model: null,
        cwd: '/runtime',
        contextEpoch: 1,
        desiredSystemPrompt,
      },
    });

    expect(createWithInitialSpec).toHaveBeenCalledOnce();
    expect(result.session.id).toBe(successorId);
  });
});

describe('EnsureRuntimeSessionService provider-missing replace path', () => {
  it('provisions a fresh provider session and logs a human-readable self-heal reason', async () => {
    const harness = missingSessionHarness();

    const ready = await harness.service.execute(
      sessionId,
      harness.desiredSystemPrompt,
    );

    expect(ready.resolution).toBe('replaced');
    // The stale generation must actually have been discarded for a genuinely
    // fresh provider session, not silently reused under a new label.
    expect(harness.createCalls).toBe(1);

    const resetLog = harness.logs.find(
      (entry) => entry.event === 'runtime.provider.session_reset',
    );
    expect(resetLog).toBeDefined();
    expect(resetLog?.level).toBe('info');
    expect(resetLog?.fields?.runtime_session_id).toBe(sessionId);
    expect(resetLog?.fields?.runtime_generation_id).toBe(generationId);
    expect(resetLog?.fields?.reason).toEqual(expect.any(String));
    expect((resetLog?.fields?.reason as string).length).toBeGreaterThan(20);

    // This log must stay distinct from the unrelated orphan-close logging so
    // it does not get lost or conflated with it.
    const orphanLog = harness.logs.find(
      (entry) => entry.event === 'runtime.provider.orphan_session',
    );
    expect(orphanLog).toBeDefined();
    expect(orphanLog?.fields?.reason).not.toBe(resetLog?.fields?.reason);
  });
});

function missingSessionHarness() {
  const desiredSystemPrompt = createDesiredRuntimeSystemPrompt('stable prompt');
  const spec = createRuntimeSessionSpec({
    runtimeSessionId: sessionId,
    revision: runtimeSpecRevision(1),
    workspaceId: 'workspace-1',
    agentVersionId: 'agent-version-1',
    environmentVersionId: null,
    resolvedSkills: [],
    toolRefs: ['agent-server/workspace-write'],
    provider: 'codex',
    model: 'model-1',
    cwd: '/tmp/replace',
    systemPromptDigest: desiredSystemPrompt.digest,
    skillSetDigest: 'skills',
    toolCatalogDigest: 'catalog',
    extensionSetDigest: 'extensions',
    contextEpoch: 1,
    createdAt: '2026-09-07T00:00:00.000Z',
  });
  const currentGeneration = {
    id: generationId,
    runtimeSessionId: sessionId,
    generation: 1,
    provider: 'codex',
    providerWorkspaceId: 'wks_1',
    providerSessionId: 'provider-session-1',
    appliedSpecRevision: runtimeSpecRevision(1),
    appliedBootstrapDigest: spec.bootstrapDigest,
    endpointEpoch: spec.extensionSetDigest,
    status: 'active' as const,
    createdAt: '2026-09-07T00:00:00.000Z',
    activeAt: '2026-09-07T00:00:00.000Z',
    supersededAt: null,
    closedAt: null,
  };
  const newGenerationId =
    '33333333-3333-4333-8333-333333333333' as RuntimeGenerationId;

  let createCalls = 0;
  const logs: {
    level: string;
    event: string;
    fields: Readonly<Record<string, unknown>> | undefined;
  }[] = [];

  const service = new EnsureRuntimeSessionService({
    provider: {
      capabilities: () => ({
        canReconfigure: false,
        canCloseSession: false,
        canInspectBootstrapDigestComponents: false,
      }),
      inspect: async () => ({
        status: 'missing' as const,
        reason: 'the provider explicitly reported the session as absent',
      }),
      create: async () => {
        createCalls += 1;
        return {
          provider: 'codex',
          model: 'model-1',
          providerWorkspaceId: 'wks_2',
          providerSessionId: 'provider-session-2',
          session: {} as never,
        };
      },
    } as never,
    sessions: {
      findById: async () => ({
        id: sessionId,
        owner: {
          tenantId: 'tenant-1',
          workspaceId: 'workspace-1',
          principalType: 'service_account',
          principalId: 'svc_1',
        },
        scope: { kind: 'agent_chat', id: 'chat-runtime-1', epoch: 1 },
        desiredSpecRevision: 1,
        currentGenerationId: generationId,
        status: 'ready',
        createdAt: '2026-09-07T00:00:00.000Z',
        updatedAt: '2026-09-07T00:00:00.000Z',
        closedAt: null,
      }),
    } as never,
    specs: {
      getDesired: async () => spec,
      get: async () => spec,
    } as never,
    generations: { findCurrent: async () => currentGeneration } as never,
    generationManager: {
      beginReplacement: async () => ({
        id: newGenerationId,
        runtimeSessionId: sessionId,
        generation: 2,
        provider: 'codex',
        providerWorkspaceId: null,
        providerSessionId: null,
        appliedSpecRevision: runtimeSpecRevision(1),
        appliedBootstrapDigest: spec.bootstrapDigest,
        endpointEpoch: spec.extensionSetDigest,
        status: 'provisioning' as const,
        createdAt: '2026-09-07T00:00:01.000Z',
        activeAt: null,
        supersededAt: null,
        closedAt: null,
      }),
      activateReplacement: async () => ({
        id: newGenerationId,
        runtimeSessionId: sessionId,
        generation: 2,
        provider: 'codex',
        providerWorkspaceId: 'wks_2',
        providerSessionId: 'provider-session-2',
        appliedSpecRevision: runtimeSpecRevision(1),
        appliedBootstrapDigest: spec.bootstrapDigest,
        endpointEpoch: spec.extensionSetDigest,
        status: 'active' as const,
        createdAt: '2026-09-07T00:00:01.000Z',
        activeAt: '2026-09-07T00:00:01.000Z',
        supersededAt: null,
        closedAt: null,
      }),
    } as never,
    grants: {
      issue: async () => ({ grantId: 'grant-1', token: 'token-1' }),
      revoke: async () => undefined,
    } as never,
    mcpEndpoint: {
      current: async () => ({
        url: 'http://127.0.0.1:39117/mcp/agent-runtime',
      }),
    },
    logger: {
      log: (level: string, event: string, fields?: Record<string, unknown>) =>
        logs.push({ level, event, fields }),
    } as never,
    now: () => new Date('2026-09-07T00:00:01.000Z'),
  });

  return {
    service,
    desiredSystemPrompt,
    get createCalls() {
      return createCalls;
    },
    logs,
  };
}

function reuseHarness() {
  const desiredSystemPrompt = createDesiredRuntimeSystemPrompt('stable prompt');
  const spec = createRuntimeSessionSpec({
    runtimeSessionId: sessionId,
    revision: runtimeSpecRevision(1),
    workspaceId: 'workspace-1',
    agentVersionId: 'agent-version-1',
    environmentVersionId: null,
    resolvedSkills: [],
    toolRefs: ['agent-server/workspace-write'],
    provider: 'codex',
    model: 'model-1',
    cwd: '/tmp/reuse',
    systemPromptDigest: desiredSystemPrompt.digest,
    skillSetDigest: 'skills',
    toolCatalogDigest: 'catalog',
    extensionSetDigest: 'extensions',
    contextEpoch: 1,
    createdAt: '2026-09-07T00:00:00.000Z',
  });
  const generation = {
    id: generationId,
    runtimeSessionId: sessionId,
    generation: 1,
    provider: 'codex',
    providerWorkspaceId: 'wks_1',
    providerSessionId: 'provider-session-1',
    appliedSpecRevision: runtimeSpecRevision(1),
    appliedBootstrapDigest: spec.bootstrapDigest,
    endpointEpoch: spec.extensionSetDigest,
    status: 'active' as const,
    createdAt: '2026-09-07T00:00:00.000Z',
    activeAt: '2026-09-07T00:00:00.000Z',
    supersededAt: null,
    closedAt: null,
  };

  let endpointCalls = 0;
  let openedAfterEndpoint = false;

  const service = new EnsureRuntimeSessionService({
    provider: {
      capabilities: () => ({
        canReconfigure: false,
        canCloseSession: false,
        canInspectBootstrapDigestComponents: false,
      }),
      inspect: async () => ({
        status: 'available' as const,
        observed: {
          providerSessionId: 'provider-session-1',
          bootstrapDigestComponents: { status: 'indeterminate' as const },
        },
      }),
      open: async () => {
        openedAfterEndpoint = endpointCalls > 0;
        return { id: 'provider-session-1' };
      },
    } as never,
    sessions: {
      findById: async () => ({
        id: sessionId,
        owner: {
          tenantId: 'tenant-1',
          workspaceId: 'workspace-1',
          principalType: 'service_account',
          principalId: 'svc_1',
        },
        scope: { kind: 'agent_chat', id: 'chat-runtime-1', epoch: 1 },
        desiredSpecRevision: 1,
        currentGenerationId: generationId,
        status: 'ready',
        createdAt: '2026-09-07T00:00:00.000Z',
        updatedAt: '2026-09-07T00:00:00.000Z',
        closedAt: null,
      }),
    } as never,
    specs: {
      getDesired: async () => spec,
      get: async () => spec,
    } as never,
    generations: { findCurrent: async () => generation } as never,
    generationManager: {} as never,
    grants: {} as never,
    mcpEndpoint: {
      current: async () => {
        endpointCalls += 1;
        return { url: 'http://127.0.0.1:39117/mcp/agent-runtime' };
      },
    },
    logger: { log: () => undefined } as never,
    now: () => new Date('2026-09-07T00:00:00.000Z'),
  });

  return {
    service,
    desiredSystemPrompt,
    get endpointCalls() {
      return endpointCalls;
    },
    get openedAfterEndpoint() {
      return openedAfterEndpoint;
    },
  };
}

function runtimeSessionForClosedScope(
  id: RuntimeSessionId,
  status: 'closed' | 'provisioning',
) {
  return {
    id,
    owner: {
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      principalType: 'service_account',
      principalId: 'svc_1',
    },
    scope: { kind: 'agent_chat' as const, id: 'chat-runtime-1', epoch: 1 },
    desiredSpecRevision: runtimeSpecRevision(1),
    currentGenerationId: null,
    status,
    createdAt: '2026-09-09T00:00:00.000Z',
    updatedAt: '2026-09-09T00:00:00.000Z',
    closedAt: status === 'closed' ? '2026-09-09T00:00:00.000Z' : null,
  };
}
