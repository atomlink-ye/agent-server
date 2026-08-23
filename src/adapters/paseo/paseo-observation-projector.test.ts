import { describe, expect, it } from 'vitest';

import type { ExecutionObservation } from '../../application/ports/runtime-execution-session.js';
import { PaseoObservationProjector } from './paseo-observation-projector.js';
import type { PaseoTimelinePage } from './paseo-client-port.js';

function createHarness() {
  const observations: ExecutionObservation[] = [];
  const projector = new PaseoObservationProjector({
    agentId: 'agent-1',
    provider: 'opencode',
    executionCwd: '/tmp/runtime-cell',
    sink: {
      emit: (observation) => {
        observations.push(observation);
      },
    },
  });
  return { projector, observations };
}

function emptyTimeline(epoch = 'epoch-1'): PaseoTimelinePage {
  return {
    epoch,
    startCursor: null,
    endCursor: null,
    window: { minSeq: 0, maxSeq: 0, nextSeq: 1 },
    entries: [],
  };
}

describe('PaseoObservationProjector', () => {
  it('filters baseline, duplicate and out-of-order assistant snapshots', async () => {
    const { projector, observations } = createHarness();
    projector.setBaseline({
      ...emptyTimeline(),
      endCursor: { epoch: 'epoch-1', seq: 2 },
      window: { minSeq: 1, maxSeq: 2, nextSeq: 3 },
    });
    const text = 'x'.repeat(700);

    projector.consumeStreamEvent({
      agentId: 'agent-1',
      eventType: 'timeline',
      timestamp: '2026-08-15T00:00:00.000Z',
      epoch: 'epoch-1',
      seq: 2,
      timelineItemType: 'assistant_message',
      assistantText: 'baseline',
    });
    projector.consumeStreamEvent({
      agentId: 'agent-1',
      eventType: 'timeline',
      timestamp: '2026-08-15T00:00:01.000Z',
      epoch: 'epoch-1',
      seq: 3,
      timelineItemType: 'assistant_message',
      assistantText: text,
    });
    projector.consumeStreamEvent({
      agentId: 'agent-1',
      eventType: 'timeline',
      timestamp: '2026-08-15T00:00:02.000Z',
      epoch: 'epoch-1',
      seq: 3,
      timelineItemType: 'assistant_message',
      assistantText: `${text} duplicate`,
    });
    projector.consumeStreamEvent({
      agentId: 'agent-1',
      eventType: 'timeline',
      timestamp: '2026-08-15T00:00:03.000Z',
      epoch: 'epoch-1',
      seq: 1,
      timelineItemType: 'assistant_message',
      assistantText: 'old',
    });
    await projector.finalize();

    const assistant = observations.filter(
      (observation) => observation.kind === 'assistant_updated',
    );
    expect(assistant).toHaveLength(1);
    expect(assistant[0]).toEqual({ kind: 'assistant_updated', text });
  });

  it('keeps terminal tool projection monotonic and improves detail without regression', async () => {
    const { projector, observations } = createHarness();
    projector.setBaseline(emptyTimeline());

    const base = {
      agentId: 'agent-1',
      eventType: 'timeline',
      timestamp: '2026-08-15T00:00:00.000Z',
      epoch: 'epoch-1',
      timelineItemType: 'tool',
    } as const;
    projector.consumeStreamEvent({
      ...base,
      seq: 1,
      toolCall: {
        callId: 'tool-1',
        name: 'shell',
        status: 'completed',
        detail: { type: 'shell', command: 'pwd', output: '/tmp/runtime-cell' },
      },
    });
    projector.consumeStreamEvent({
      ...base,
      seq: 2,
      toolCall: {
        callId: 'tool-1',
        name: 'shell',
        status: 'running',
        detail: { type: 'shell', command: 'pwd' },
      },
    });
    await projector.finalize();

    const tool = observations.filter(
      (observation) => observation.kind === 'tool_updated',
    );
    expect(tool).toHaveLength(1);
    expect(tool[0]).toMatchObject({
      kind: 'tool_updated',
      status: 'completed',
      category: 'shell',
      detail: { kind: 'shell', command: 'pwd' },
    });
  });

  it('correlates provider subagent activity without leaking provider child ids', async () => {
    const { projector, observations } = createHarness();
    projector.setBaseline(emptyTimeline());
    projector.consumeStreamEvent({
      agentId: 'agent-1',
      eventType: 'timeline',
      timestamp: '2026-08-15T00:00:00.000Z',
      epoch: 'epoch-1',
      seq: 1,
      timelineItemType: 'tool',
      toolCall: {
        callId: 'parent-call',
        name: 'delegate',
        status: 'running',
        detail: {
          type: 'sub_agent',
          subAgentType: 'verifier',
          childSessionId: 'provider-child-secret',
        },
      },
    });
    expect(
      projector.consumeProviderSubagentDescriptor({
        id: 'provider-child-secret',
        parentAgentId: 'agent-1',
        status: 'running',
        title: 'Verify nested work',
        description: null,
        toolCallId: 'parent-call',
      }),
    ).toBe(true);
    projector.consumeChildTimeline(
      {
        id: 'provider-child-secret',
        parentAgentId: 'agent-1',
        status: 'running',
        title: 'Verify nested work',
        description: null,
        toolCallId: 'parent-call',
      },
      {
        parentAgentId: 'agent-1',
        subagentId: 'provider-child-secret',
        epoch: 'child-epoch',
        direction: 'tail',
        rows: [
          {
            seq: 1,
            timestamp: '2026-08-15T00:00:01.000Z',
            item: {
              timelineItemType: 'assistant_message',
              assistantText: 'nested result '.repeat(60),
            },
          },
        ],
        hasOlder: false,
      },
    );
    projector.finalizeProviderSubagent({
      id: 'provider-child-secret',
      parentAgentId: 'agent-1',
      status: 'completed',
      title: 'Verify nested work',
      description: null,
      toolCallId: 'parent-call',
    });
    await projector.finalize();

    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'tool_updated',
          category: 'subagent',
          label: 'Sub-agent task: Verify nested work',
        }),
        expect.objectContaining({
          kind: 'child_activity_updated',
          itemKind: 'assistant',
        }),
      ]),
    );
    expect(JSON.stringify(observations)).not.toContain('provider-child-secret');
  });

  it('merges final catch-up once and redacts credentials and host paths', async () => {
    const { projector, observations } = createHarness();
    projector.setBaseline(emptyTimeline());
    const page: PaseoTimelinePage = {
      epoch: 'epoch-1',
      startCursor: { epoch: 'epoch-1', seq: 1 },
      endCursor: { epoch: 'epoch-1', seq: 1 },
      window: { minSeq: 1, maxSeq: 1, nextSeq: 2 },
      entries: [
        {
          timelineItemType: 'assistant_message',
          assistantText:
            'Authorization: Bearer top-secret-token and /tmp/runtime-cell/output.txt',
          timestamp: '2026-08-15T00:00:00.000Z',
          seqStart: 1,
          seqEnd: 1,
        },
      ],
    };

    await projector.finalize({ finalTimeline: page });

    const serialized = JSON.stringify(observations);
    expect(serialized).toContain('[REDACTED]');
    expect(serialized).not.toContain('top-secret-token');
    expect(serialized).not.toContain('/tmp/runtime-cell');
  });
});
