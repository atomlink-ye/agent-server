import { describe, expect, it } from 'vitest';

import {
  EnsureRuntimeSessionService,
  planWhenBootstrapDigestIsIndeterminate,
} from './ensure-runtime-session.js';
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
