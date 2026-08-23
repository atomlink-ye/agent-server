import { describe, expect, it } from 'vitest';

import type { ExecutionObservation } from '../../application/ports/execution-plane.js';
import type { PaseoClientPort } from './paseo-client-port.js';
import { PaseoGateway } from './paseo-gateway.js';
import { PaseoTurnRunner } from './paseo-turn-runner.js';

const logger = { log: () => undefined };

function createClient(
  options: {
    finalStatus?: string;
    finalMessage?: string;
    waitError?: Error;
  } = {},
) {
  let timelineReads = 0;
  const client = {
    async fetchAgentTimeline() {
      timelineReads += 1;
      if (timelineReads === 1)
        return {
          epoch: 'epoch-1',
          startCursor: null,
          endCursor: null,
          window: { minSeq: 0, maxSeq: 0, nextSeq: 1 },
          entries: [],
        };
      return {
        epoch: 'epoch-1',
        startCursor: { epoch: 'epoch-1', seq: 1 },
        endCursor: { epoch: 'epoch-1', seq: 1 },
        window: { minSeq: 1, maxSeq: 1, nextSeq: 2 },
        entries: [
          {
            timelineItemType: 'assistant_message',
            assistantText: options.finalMessage ?? 'final answer',
            timestamp: '2026-08-15T00:00:01.000Z',
            seqStart: 1,
            seqEnd: 1,
          },
        ],
      };
    },
    subscribeToAgentStream(_agentId: string, listener: (event: any) => void) {
      listener({
        agentId: 'agent-1',
        eventType: 'timeline',
        timestamp: '2026-08-15T00:00:00.500Z',
        epoch: 'epoch-1',
        seq: 1,
        timelineItemType: 'assistant_message',
        assistantText: 'final answer',
      });
      return () => undefined;
    },
    subscribeToProviderSubagentUpdates() {
      return () => undefined;
    },
    async sendAgentMessage() {},
    async waitForFinish() {
      if (options.waitError) throw options.waitError;
      return {
        status: options.finalStatus ?? 'idle',
        error: options.finalStatus === 'error' ? 'provider failed' : null,
        lastMessage: options.finalMessage ?? 'final answer',
        usage: { inputTokens: 2, outputTokens: 3 },
      };
    },
    async listProviderSubagents() {
      return [];
    },
    async fetchProviderSubagentTimeline() {
      return null;
    },
  } as unknown as PaseoClientPort;
  return { client, timelineReads: () => timelineReads };
}

describe('PaseoTurnRunner', () => {
  it('owns one turn lifecycle and merges final catch-up without duplicate output', async () => {
    const { client, timelineReads } = createClient();
    const observations: ExecutionObservation[] = [];
    const runner = new PaseoTurnRunner(new PaseoGateway(client), logger, {
      executionTimeoutMs: 2_000,
      additionalProjectionRoots: ['/tmp'],
    });

    const result = await runner.run({
      run: { runId: 'run-1', prompt: 'hello' },
      agentId: 'agent-1',
      provider: 'opencode',
      model: 'free/model',
      cwd: '/tmp/runtime-cell',
      observer: {
        emit: (observation) => {
          observations.push(observation);
        },
      },
    });

    expect(result).toMatchObject({
      status: 'completed',
      output: {
        provider: 'opencode',
        model: 'free/model',
        text: 'final answer',
      },
    });
    expect(timelineReads()).toBeGreaterThanOrEqual(2);
    expect(
      observations.filter((item) => item.kind === 'assistant_updated'),
    ).toHaveLength(1);
    expect(observations[0]).toEqual({ kind: 'turn_started', runId: 'run-1' });
    expect(observations.at(-1)).toEqual({
      kind: 'turn_completed',
      provider: 'opencode',
      model: 'free/model',
    });
  });

  it('returns an expected failed Turn result for provider terminal failure', async () => {
    const { client } = createClient({ finalStatus: 'error' });
    const runner = new PaseoTurnRunner(new PaseoGateway(client), logger, {
      executionTimeoutMs: 2_000,
    });
    await expect(
      runner.run({
        run: { runId: 'run-failed', prompt: 'hello' },
        agentId: 'agent-1',
        provider: 'opencode',
        model: 'free/model',
        cwd: '/tmp/runtime-cell',
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      failure: { message: expect.stringMatching(/provider failed|failed/i) },
    });
  });

  it('records a thrown wait rejection without claiming a provider timeout', async () => {
    const { client } = createClient({ waitError: new Error('request failed') });
    const logs: {
      event: string;
      fields: Readonly<Record<string, unknown>> | undefined;
    }[] = [];
    const runner = new PaseoTurnRunner(
      new PaseoGateway(client),
      { log: (_level, event, fields) => logs.push({ event, fields }) },
      { executionTimeoutMs: 2_000 },
    );

    await expect(
      runner.run({
        run: { runId: 'run-rejected', prompt: 'hello' },
        agentId: 'agent-1',
        provider: 'opencode',
        model: 'free/model',
        cwd: '/tmp/runtime-cell',
      }),
    ).rejects.toMatchObject({ name: 'ExecutionPlaneUnavailableError' });

    expect(logs).toContainEqual({
      event: 'runtime.provider.wait.completed',
      fields: expect.objectContaining({
        status: 'rejected_indistinguishable_at_boundary',
        reason: 'provider_wait_error_indistinguishable_at_boundary',
      }),
    });
  });
});
