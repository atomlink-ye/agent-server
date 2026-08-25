import { describe, expect, it } from 'vitest';

import {
  acknowledgedMessagesWithoutActivation,
  classifySmokeOutcome,
  evaluateCompletionFacts,
  evaluateTraceFacts,
  formatSmokeOutcome,
} from './agent-team-completion-line.mjs';

function successfulProjection() {
  return {
    project: { status: 'succeeded' },
    gates: {
      finish_ready: true,
      all_work_accepted: true,
      no_active_attempts: true,
      all_members_idle: true,
    },
    work_items: [
      {
        work_ref: 'work-1',
        status: 'accepted',
        assignee_name: 'member',
        attempts: [
          {
            attempt_no: 1,
            status: 'completed',
            result_summary: 'AGENT_TEAM_SMOKE_MEMBER_OK',
          },
        ],
      },
    ],
    direct_messages: [
      {
        sequence: 3,
        sender_name: 'member',
        recipient_name: 'lead',
        summary: 'AGENT_TEAM_SMOKE_DIRECT_REQUIRES_ACK',
        requires_ack: true,
        status: 'acknowledged',
      },
    ],
    sessions: [
      {
        name: 'member',
        role: 'member',
        turns: [
          {
            kind: 'direct_message',
            activation: {
              materializer: 'task_run_collaboration_activation_adapter',
              causes: [{ type: 'work_available', work_ref: 'W-1' }],
            },
          },
          {
            kind: 'direct_message',
            activation: {
              materializer: 'task_run_collaboration_activation_adapter',
              causes: [{ type: 'message', message_ref: 'M-3' }],
            },
          },
        ],
      },
      {
        name: 'lead',
        role: 'lead',
        turns: [
          {
            kind: 'lead_turn',
            activation: {
              materializer: 'task_run_collaboration_activation_adapter',
              causes: [{ type: 'final_review' }],
            },
          },
        ],
      },
    ],
  };
}

function codes(projection) {
  return evaluateCompletionFacts(projection).failures.map(
    (failure) => failure.code,
  );
}

describe('agent-team smoke completion line', () => {
  it('accepts an acknowledged direct message that wakes any participant', () => {
    const result = evaluateCompletionFacts(successfulProjection());

    expect(result).toEqual({ ok: true, failures: [] });
  });

  it('rejects a message that was not acknowledged', () => {
    const projection = successfulProjection();
    projection.direct_messages[0].status = 'presented';

    expect(codes(projection)).toContain('acknowledged_direct_message');
  });

  it('enforces the acknowledged-message activation invariant', () => {
    const projection = successfulProjection();
    projection.sessions[0].turns = [];

    expect(acknowledgedMessagesWithoutActivation(projection)).toEqual([
      expect.objectContaining({ sequence: 3 }),
    ]);
    expect(codes(projection)).toContain('acknowledged_message_activation');
  });

  it('rejects a durable pending message that never materialized a participant turn', () => {
    const projection = successfulProjection();
    projection.direct_messages[0].status = 'pending';
    projection.sessions[0].turns = [];

    expect(codes(projection)).toContain('pending_message_activation');
    expect(codes(projection)).not.toContain('acknowledged_direct_message');
  });

  it('rejects a collaboration with no direct message', () => {
    const projection = successfulProjection();
    projection.direct_messages = [];

    expect(codes(projection)).toContain('direct_message_count');
  });

  it('rejects a direct message that does not require an acknowledgement', () => {
    const projection = successfulProjection();
    projection.direct_messages[0].requires_ack = false;
    projection.direct_messages[0].status = 'presented';

    expect(codes(projection)).toContain('requires_ack_direct_message');
  });

  it('rejects work that was not accepted', () => {
    const projection = successfulProjection();
    projection.work_items[0].status = 'submitted';

    expect(codes(projection)).toContain('work_1_accepted');
  });

  it('classifies an assertion-only failure without any collaboration failure', () => {
    const projection = successfulProjection();
    projection.sessions[1].turns = [];

    const outcome = classifySmokeOutcome({
      taskStatus: 'completed',
      projection,
    });
    expect(outcome).toMatchObject({
      kind: 'assertion_failed',
      failures: [expect.objectContaining({ code: 'final_review_activation' })],
    });
    expect(
      outcome.failures.every((failure) => failure.scope === 'assertion'),
    ).toBe(true);
  });

  it('reports a completed collaboration with an unacknowledged message as collaboration failure', () => {
    const projection = successfulProjection();
    projection.direct_messages[0].status = 'presented';

    expect(
      classifySmokeOutcome({ taskStatus: 'completed', projection }),
    ).toMatchObject({
      kind: 'collaboration_not_achieved',
      failures: [
        expect.objectContaining({ code: 'acknowledged_direct_message' }),
      ],
    });
  });

  it('reports an expired budget before a terminal task as a gate timeout, not a product failure', () => {
    expect(
      classifySmokeOutcome({
        taskStatus: 'active',
        projection: successfulProjection(),
        timedOut: true,
      }),
    ).toEqual({
      kind: 'gate_timeout',
      taskStatus: 'active',
      failures: [],
    });
  });

  it('keeps an empty-board nonterminal task pending until the gate budget expires', () => {
    const stalled = {
      project: { status: 'active' },
      gates: {
        finish_ready: false,
        all_work_accepted: false,
        no_active_attempts: true,
        all_members_idle: false,
      },
      work_items: [],
      direct_messages: [],
      sessions: [],
    };

    expect(
      classifySmokeOutcome({ taskStatus: 'active', projection: stalled }),
    ).toMatchObject({ kind: 'pending', failures: [] });
    expect(
      classifySmokeOutcome({
        taskStatus: 'active',
        projection: stalled,
        timedOut: true,
      }),
    ).toEqual({
      kind: 'gate_timeout',
      taskStatus: 'active',
      failures: [],
    });
  });

  it('formats collaboration failure, assertion failure, and gate timeout distinctly', () => {
    const collaborationProjection = successfulProjection();
    collaborationProjection.direct_messages[0].status = 'presented';
    const assertionProjection = successfulProjection();
    assertionProjection.sessions[1].turns = [];

    const diagnostics = [
      formatSmokeOutcome(
        classifySmokeOutcome({
          taskStatus: 'completed',
          projection: collaborationProjection,
        }),
      ),
      formatSmokeOutcome(
        classifySmokeOutcome({
          taskStatus: 'completed',
          projection: assertionProjection,
        }),
      ),
      formatSmokeOutcome(
        classifySmokeOutcome({
          taskStatus: 'active',
          projection: successfulProjection(),
          timedOut: true,
        }),
      ),
    ];

    expect(diagnostics[0]).toContain('collaboration not achieved');
    expect(diagnostics[1]).toContain('completion-line assertion failed');
    expect(diagnostics[2]).toContain(
      'gate timeout, not evidence of product failure',
    );
  });

  it('names distinct missing facts in its diagnostic output', () => {
    const noAck = successfulProjection();
    noAck.direct_messages[0].status = 'presented';
    const noRequiresAck = successfulProjection();
    noRequiresAck.direct_messages[0].requires_ack = false;
    noRequiresAck.direct_messages[0].status = 'presented';
    const noWake = successfulProjection();
    noWake.sessions[0].turns = [];
    const pendingWithoutWake = successfulProjection();
    pendingWithoutWake.direct_messages[0].status = 'pending';
    pendingWithoutWake.sessions[0].turns = [];
    const noAcceptedWork = successfulProjection();
    noAcceptedWork.work_items[0].status = 'submitted';

    const diagnostics = [
      noAck,
      noRequiresAck,
      noWake,
      pendingWithoutWake,
      noAcceptedWork,
    ].map((projection) =>
      formatSmokeOutcome(
        classifySmokeOutcome({ taskStatus: 'completed', projection }),
      ),
    );

    expect(diagnostics).toHaveLength(new Set(diagnostics).size);
    expect(diagnostics[0]).toContain('acknowledged_direct_message');
    expect(diagnostics[1]).toContain('requires_ack_direct_message');
    expect(diagnostics[2]).toContain('acknowledged_message_activation');
    expect(diagnostics[3]).toContain('pending_message_activation');
    expect(diagnostics[4]).toContain('work_1_accepted');
  });

  it('requires one completed synthetic stock trace activity', () => {
    expect(
      evaluateTraceFacts({
        mcp_activities: [
          {
            activity_id: 'stock-1',
            tool_name: 'synthetic_stock_snapshot',
            status: 'running',
          },
          {
            activity_id: 'stock-1',
            tool_name: 'synthetic_stock_snapshot',
            status: 'completed',
          },
        ],
      }),
    ).toEqual({ ok: true, failures: [] });
    expect(
      evaluateTraceFacts({
        mcp_activities: [
          {
            activity_id: 'stock-1',
            tool_name: 'synthetic_stock_snapshot',
            status: 'failed',
          },
        ],
      }).failures.map((failure) => failure.code),
    ).toEqual(['synthetic_stock_snapshot_activity_status']);
  });
});
