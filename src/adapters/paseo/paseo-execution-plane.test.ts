import { describe, expect, it } from 'vitest';

import {
  ExecutionBindingUnavailableError,
  supportsPlaneCapability,
  supportsSessionCapability,
} from '../../application/ports/execution-plane.js';
import type {
  PaseoClientPort,
  PaseoCreatedAgent,
  PaseoFinishedAgent,
  PaseoTimelinePage,
} from './paseo-client-port.js';
import { PaseoExecutionPlane } from './paseo-execution-plane.js';

const logger = { log: () => undefined };

class FakePlaneClient implements PaseoClientPort {
  status = 'idle';
  createCalls = 0;
  sendCalls: { agentId: string; text: string }[] = [];
  cancelCalls = 0;
  closeCalls = 0;
  timelineError: Error | null = null;

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
  async createAgent(): Promise<PaseoCreatedAgent> {
    this.createCalls += 1;
    return { id: 'agent-1', provider: 'opencode', model: 'free/model' };
  }
  async sendAgentMessage(agentId: string, text: string) {
    this.sendCalls.push({ agentId, text });
  }
  async waitForFinish(): Promise<PaseoFinishedAgent> {
    return {
      status: 'idle',
      error: null,
      lastMessage: 'done',
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  }
  async fetchAgentTimeline(): Promise<PaseoTimelinePage> {
    if (this.timelineError) throw this.timelineError;
    return {
      epoch: 'epoch-1',
      startCursor: null,
      endCursor: null,
      window: { minSeq: 0, maxSeq: 0, nextSeq: 1 },
      entries: [],
    };
  }
  async cancelAgent() {
    this.cancelCalls += 1;
  }
  async close() {
    this.closeCalls += 1;
    this.status = 'disposed';
  }
}

function createPlane(client: FakePlaneClient) {
  return new PaseoExecutionPlane(
    {
      wsUrl: 'ws://test',
      cwd: '/tmp/execution-plane-test',
      provider: 'opencode',
      workspaceTitle: 'Execution Plane Test',
      connectTimeoutMs: 1,
      executionTimeoutMs: 1_000,
    },
    logger,
    client,
  );
}

const sessionSpec = {
  runtimeSessionId: 'runtime-session-1',
  workspace: { cwd: '/tmp/execution-plane-test/cell-1' },
  provider: 'opencode',
  model: 'free/model',
  systemPrompt: 'system',
} as const;

describe('PaseoExecutionPlane', () => {
  it('creates external bindings without sending the first prompt', async () => {
    const client = new FakePlaneClient();
    const plane = createPlane(client);

    const created = await plane.createSession(sessionSpec);

    expect(client.createCalls).toBe(1);
    expect(client.sendCalls).toEqual([]);
    expect(created.workspaceBinding).toEqual({
      plane: 'paseo',
      externalWorkspaceId: 'runtime-workspace',
    });
    expect(created.sessionBinding).toEqual({
      plane: 'paseo',
      externalSessionId: 'agent-1',
    });

    const result = await created.session.run({
      runId: 'run-1',
      prompt: 'first',
    });
    expect(result).toMatchObject({
      status: 'completed',
      output: { text: 'done', provider: 'opencode', model: 'free/model' },
    });
    expect(client.sendCalls).toEqual([{ agentId: 'agent-1', text: 'first' }]);
  });

  it('attaches an existing session without creating a replacement', async () => {
    const client = new FakePlaneClient();
    const plane = createPlane(client);
    const attached = await plane.attachSession(
      { plane: 'paseo', externalSessionId: 'existing-agent' },
      {
        ...sessionSpec,
        workspace: {
          cwd: '/tmp/execution-plane-test/cell-1',
          binding: {
            plane: 'paseo',
            externalWorkspaceId: 'existing-workspace',
          },
        },
      },
    );

    expect(client.createCalls).toBe(0);
    if (attached.kind === 'replacement_required')
      throw new Error('Expected the existing session to remain attachable.');
    await attached.session.run({ runId: 'run-2', prompt: 'continue' });
    expect(client.sendCalls).toEqual([
      { agentId: 'existing-agent', text: 'continue' },
    ]);
  });

  it('fails attach explicitly and never creates a replacement', async () => {
    const client = new FakePlaneClient();
    client.timelineError = new Error('missing agent');
    const plane = createPlane(client);

    const outcome = await plane.attachSession(
      { plane: 'paseo', externalSessionId: 'missing-agent' },
      {
        ...sessionSpec,
        workspace: {
          cwd: '/tmp/execution-plane-test/cell-1',
          binding: {
            plane: 'paseo',
            externalWorkspaceId: 'existing-workspace',
          },
        },
      },
    );
    expect(outcome).toEqual({
      kind: 'replacement_required',
      reason: 'provider_binding_stale',
    });
    expect(client.createCalls).toBe(0);
    expect(client.sendCalls).toEqual([]);
  });

  it('keeps ExecutionSession.close non-destructive', async () => {
    const client = new FakePlaneClient();
    const created = await createPlane(client).createSession(sessionSpec);

    await created.session.close();

    expect(client.cancelCalls).toBe(0);
    expect(client.closeCalls).toBe(0);
    await expect(
      created.session.run({ runId: 'closed-run', prompt: 'nope' }),
    ).rejects.toBeInstanceOf(ExecutionBindingUnavailableError);
  });

  it('publishes plane and session capabilities separately', async () => {
    const client = new FakePlaneClient();
    const plane = createPlane(client);
    const created = await plane.createSession(sessionSpec);

    expect(supportsPlaneCapability(plane.capabilities(), 'streaming')).toBe(
      true,
    );
    expect(
      supportsPlaneCapability(plane.capabilities(), 'provider_discovery'),
    ).toBe(true);
    expect(
      supportsSessionCapability(
        created.session.capabilities,
        'reasoning_stream',
      ),
    ).toBe(true);
    expect(
      supportsSessionCapability(
        created.session.capabilities,
        'permission_response',
      ),
    ).toBe(false);
  });
});
