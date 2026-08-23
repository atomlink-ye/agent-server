import { describe, expect, it } from 'vitest';

import type {
  PaseoClientPort,
  PaseoTimelinePage,
} from '../../../adapters/paseo/paseo-client-port.js';
import { PaseoClientProjectionError } from '../../../adapters/paseo/paseo-client-port.js';
import { UnsupportedCapabilityError } from '../../../application/ports/execution-plane.js';
import type { ProviderSessionBinding } from '../../../application/ports/runtime-execution-provider.js';
import type { Logger } from '../../../shared/observability/logger.js';
import type {
  RuntimeGenerationId,
  RuntimeSessionId,
} from '../../../domain/runtime/runtime-session.js';
import { runtimeSpecRevision } from '../../../domain/runtime/runtime-session.js';
import { mapPaseoConfig } from './paseo-config-mapper.js';
import { normalizePaseoRequestedModel } from './paseo-model-normalizer.js';
import { PaseoRuntimeProvider } from './paseo-runtime-provider.js';

const logger: Logger = { log: () => undefined };
const runtimeSessionId = 'runtime-1' as RuntimeSessionId;

const timeline: PaseoTimelinePage = {
  epoch: 'epoch-1',
  startCursor: null,
  endCursor: null,
  window: { minSeq: 0, maxSeq: 0, nextSeq: 1 },
  entries: [],
};

class FakeClient implements PaseoClientPort {
  status = 'idle';
  timelineError: Error | null = null;
  actualProvider = 'opencode';
  actualModel = 'free/model';

  async connect() {
    this.status = 'connected';
  }
  connectionStatus() {
    return this.status;
  }
  async openWorkspace() {
    return 'default-workspace';
  }
  async createIndependentWorkspace() {
    return 'runtime-workspace';
  }
  async setWorkspaceTitle() {}
  async listModels() {
    return [{ id: 'free/model', label: 'free' }];
  }
  async createAgent() {
    return {
      id: 'agent-1',
      provider: this.actualProvider,
      model: this.actualModel,
    };
  }
  async sendAgentMessage() {}
  async waitForFinish() {
    return { status: 'idle' as const, error: null, lastMessage: 'done' };
  }
  async fetchAgentTimeline() {
    if (this.timelineError) throw this.timelineError;
    return timeline;
  }
  async closeSession() {
    this.status = 'closed';
  }
}

function binding(
  overrides: Partial<ProviderSessionBinding> = {},
): ProviderSessionBinding {
  return {
    generation: {
      id: 'generation-1' as RuntimeGenerationId,
      runtimeSessionId,
      provider: 'opencode',
      providerWorkspaceId: 'workspace-1',
      providerSessionId: 'agent-1',
      appliedSpecRevision: runtimeSpecRevision(1),
    },
    applied: {
      runtimeSessionId,
      revision: runtimeSpecRevision(1),
      provider: 'opencode',
      model: 'free/model',
      cwd: '/tmp/paseo-provider-test',
      systemPrompt: 'system',
    },
    ...overrides,
  };
}

function provider(
  client: PaseoClientPort = new FakeClient(),
  providerLogger: Logger = logger,
): PaseoRuntimeProvider {
  return new PaseoRuntimeProvider(
    {
      wsUrl: 'ws://test',
      cwd: '/tmp/paseo-provider-test',
      provider: 'opencode',
      workspaceTitle: 'Provider Test',
      connectTimeoutMs: 1,
      executionTimeoutMs: 1_000,
    },
    providerLogger,
    client,
  );
}

describe('PaseoRuntimeProvider', () => {
  it('advertises honest session capabilities', () => {
    expect(provider().capabilities()).toEqual({
      canReconfigure: false,
      canCloseSession: false,
      canInspectBootstrapDigestComponents: false,
    });
  });

  it('owns Paseo model normalization and config mapping', () => {
    expect(
      normalizePaseoRequestedModel('claude', 'opencode-go/claude-sonnet'),
    ).toBe('claude-sonnet');
    expect(normalizePaseoRequestedModel('opencode', 'opencode-go/model')).toBe(
      'opencode-go/model',
    );
    const mapped = mapPaseoConfig({
      paseo: {
        wsUrl: 'ws://test',
        provider: 'codex',
        agentCwd: '/tmp/paseo-provider-test',
        workspaceTitle: 'Provider Test',
        model: 'opencode-go/codex-model',
        connectTimeoutMs: 1,
        connectTimeoutSource: 'default',
        executionTimeoutMs: 1_000,
        executionTimeoutSource: 'default',
        sessionRpcTimeoutMs: 1_000,
        sessionRpcTimeoutSource: 'default',
      },
    });
    expect(mapped.requestedModel).toBe('codex-model');
  });

  it('uses timeline inspection and preserves uncertainty as unavailable', async () => {
    await expect(provider().inspect(binding())).resolves.toMatchObject({
      status: 'available',
      observed: {
        providerSessionId: 'agent-1',
        bootstrapDigestComponents: {
          status: 'indeterminate',
          reason:
            'Paseo cannot report RuntimeBootstrapDigestInput components during session inspection.',
        },
      },
    });

    const genericFailure = new FakeClient();
    genericFailure.timelineError = new Error('transport failed');
    const logs: Array<{
      readonly event: string;
      readonly attributes?: Readonly<Record<string, unknown>>;
    }> = [];
    await expect(
      provider(genericFailure, {
        log(_level, event, attributes) {
          logs.push({ event, ...(attributes ? { attributes } : {}) });
        },
      }).inspect(binding()),
    ).resolves.toEqual({
      status: 'unavailable',
      reason: 'Paseo session inspection failed.',
    });
    expect(logs).toContainEqual({
      event: 'runtime.provider.inspect.unavailable',
      attributes: expect.objectContaining({
        provider: 'paseo',
        operation: 'inspect',
        error_type: 'Error',
      }),
    });

    const protocolFailure = new FakeClient();
    protocolFailure.timelineError = new PaseoClientProjectionError();
    await expect(
      provider(protocolFailure).inspect(binding()),
    ).resolves.toMatchObject({
      status: 'unavailable',
    });

    const missingTimeline = withoutTimeline(new FakeClient());
    await expect(provider(missingTimeline).inspect(binding())).resolves.toEqual(
      {
        status: 'unavailable',
        reason: 'Paseo session timeline inspection is unavailable.',
      },
    );
  });

  it('classifies missing and structurally wrong bindings without probing errors', async () => {
    await expect(
      provider().inspect(
        binding({
          generation: { ...binding().generation, providerSessionId: '' },
        }),
      ),
    ).resolves.toMatchObject({ status: 'stale' });
    const missing = new FakeClient();
    missing.timelineError = Object.assign(new Error('ignored'), {
      code: 'provider_session_not_found',
    });
    await expect(provider(missing).inspect(binding())).resolves.toMatchObject({
      status: 'missing',
    });
    await expect(
      provider().inspect(
        binding({
          generation: { ...binding().generation, provider: 'claude' },
        }),
      ),
    ).resolves.toMatchObject({ status: 'stale' });
  });

  it('retains Paseo-returned provider and model identity on create', async () => {
    const client = new FakeClient();
    client.actualProvider = 'claude';
    client.actualModel = 'claude/actual-model';
    const created = await provider(client).create({
      runtimeSessionId,
      provider: 'opencode',
      model: 'free/model',
      cwd: '/tmp/paseo-provider-test',
      systemPrompt: 'system',
    });
    expect(created).toMatchObject({
      provider: 'claude',
      model: 'claude/actual-model',
      providerSessionId: 'agent-1',
    });
  });

  it('rejects provider close when Paseo cannot close a session', async () => {
    await expect(provider().closeSession(binding())).rejects.toBeInstanceOf(
      UnsupportedCapabilityError,
    );
  });
});

function withoutTimeline(client: FakeClient): PaseoClientPort {
  return {
    connect: client.connect.bind(client),
    connectionStatus: client.connectionStatus.bind(client),
    openWorkspace: client.openWorkspace.bind(client),
    createIndependentWorkspace: client.createIndependentWorkspace.bind(client),
    setWorkspaceTitle: client.setWorkspaceTitle.bind(client),
    listModels: client.listModels.bind(client),
    createAgent: client.createAgent.bind(client),
    sendAgentMessage: client.sendAgentMessage.bind(client),
    waitForFinish: client.waitForFinish.bind(client),
    close: client.close.bind(client),
  };
}
