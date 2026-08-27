import { describe, expect, it } from 'vitest';

import {
  acknowledgedMessagesWithoutActivation,
  classifySmokeOutcome,
  evaluateCompletionFacts,
  evaluateLeadTerminalFacts,
  evaluateMemberWorkTraceFacts,
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
            kind: 'work_attempt',
            run_id: 'member-run-1',
            activation: {
              materializer: 'task_run_collaboration_activation_adapter',
              causes: [{ type: 'assignment', work_ref: 'W-1' }],
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
            run_id: 'lead-run-1',
            activation: {
              materializer: 'task_run_collaboration_activation_adapter',
              causes: [
                { type: 'message', message_ref: 'M-3' },
                { type: 'final_review' },
              ],
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

function completeMemberTrace() {
  return {
    mcp_activities: [
      {
        activity_id: 'stock-1',
        sequence: 10,
        tool_name: 'synthetic_stock_snapshot',
        status: 'completed',
        source_refs: { run_id: 'member-run-1' },
      },
      {
        activity_id: 'message-1',
        sequence: 11,
        tool_name: 'message_send',
        status: 'completed',
        source_refs: { run_id: 'member-run-1' },
      },
      {
        activity_id: 'submit-1',
        sequence: 12,
        tool_name: 'board_submit',
        status: 'completed',
        source_refs: { run_id: 'member-run-1' },
      },
    ],
  };
}

function completeLeadTrace() {
  return {
    mcp_activities: [
      {
        activity_id: 'ack-1',
        sequence: 10,
        tool_name: 'message_ack',
        status: 'completed',
        source_refs: { run_id: 'lead-run-1' },
      },
      {
        activity_id: 'accept-1',
        sequence: 11,
        tool_name: 'board_accept',
        status: 'completed',
        source_refs: { run_id: 'lead-run-1' },
      },
      {
        activity_id: 'finish-1',
        sequence: 12,
        tool_name: 'collaboration_finish',
        status: 'completed',
        source_refs: { run_id: 'lead-run-1' },
      },
    ],
  };
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
    projection.sessions[1].turns = [];

    expect(acknowledgedMessagesWithoutActivation(projection)).toEqual([
      expect.objectContaining({ sequence: 3 }),
    ]);
    expect(codes(projection)).toContain('acknowledged_message_activation');
  });

  it('requires the terminal lead activation to coalesce message and final review', () => {
    const projection = successfulProjection();
    projection.sessions[1].turns[0].activation.causes = [
      { type: 'final_review' },
    ];

    expect(codes(projection)).toContain('terminal_activation_coalesced');
  });

  it('rejects a durable pending message that never materialized a participant turn', () => {
    const projection = successfulProjection();
    projection.direct_messages[0].status = 'pending';
    projection.sessions[1].turns = [];

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
    projection.sessions[1].turns[0].activation.causes = [
      { type: 'message', message_ref: 'M-3' },
    ];

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
    assertionProjection.sessions[1].turns[0].activation.causes = [
      { type: 'message', message_ref: 'M-3' },
    ];

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
    noWake.sessions[1].turns = [];
    const pendingWithoutWake = successfulProjection();
    pendingWithoutWake.direct_messages[0].status = 'pending';
    pendingWithoutWake.sessions[1].turns = [];
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
            activity_id: 'activity-2',
            sequence: 2,
            tool_name: 'synthetic_stock_snapshot',
            status: 'failed',
          },
          {
            activity_id: 'activity-3',
            sequence: 3,
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
            activity_id: 'activity-2',
            sequence: 2,
            tool_name: 'synthetic_stock_snapshot',
            status: 'failed',
          },
        ],
      }).failures.map((failure) => failure.code),
    ).toEqual(['synthetic_stock_snapshot_activity_status']);
  });

  it('requires terminal lead mutations to come from the coalesced lead run', () => {
    const trace = {
      mcp_activities: [
        {
          activity_id: 'activity-2',
          sequence: 2,
          tool_name: 'message_ack',
          status: 'failed',
          source_refs: { run_id: 'lead-run-1' },
        },
        {
          activity_id: 'activity-3',
          sequence: 3,
          tool_name: 'message_ack',
          status: 'completed',
          source_refs: { run_id: 'lead-run-1' },
        },
        {
          activity_id: 'accept-1',
          sequence: 4,
          tool_name: 'board_accept',
          status: 'completed',
          source_refs: { run_id: 'lead-run-1' },
        },
        {
          activity_id: 'finish-1',
          sequence: 5,
          tool_name: 'collaboration_finish',
          status: 'completed',
          source_refs: { run_id: 'lead-run-1' },
        },
      ],
    };
    expect(evaluateLeadTerminalFacts(successfulProjection(), trace)).toEqual({
      ok: true,
      failures: [],
    });
    trace.mcp_activities[3].source_refs.run_id = 'other-lead-run';
    expect(
      evaluateLeadTerminalFacts(successfulProjection(), trace).failures.map(
        (failure) => failure.code,
      ),
    ).toContain('terminal_lead_collaboration_finish');
    trace.mcp_activities[3].source_refs.run_id = 'lead-run-1';
    trace.mcp_activities[1].source_refs.run_id = 'other-lead-run';
    expect(
      evaluateLeadTerminalFacts(successfulProjection(), trace).failures.map(
        (failure) => failure.code,
      ),
    ).toContain('terminal_lead_message_ack');
  });

  it('isolates lead logical steps to the owning run', () => {
    const trace = {
      mcp_activities: [
        {
          activity_id: 'activity-2',
          sequence: 2,
          tool_name: 'message_ack',
          status: 'completed',
          source_refs: { run_id: 'other-lead-run' },
        },
        {
          activity_id: 'accept-1',
          sequence: 3,
          tool_name: 'board_accept',
          status: 'completed',
          source_refs: { run_id: 'lead-run-1' },
        },
        {
          activity_id: 'finish-1',
          sequence: 4,
          tool_name: 'collaboration_finish',
          status: 'completed',
          source_refs: { run_id: 'lead-run-1' },
        },
      ],
    };

    expect(
      evaluateLeadTerminalFacts(successfulProjection(), trace).failures.map(
        (failure) => failure.code,
      ),
    ).toContain('terminal_lead_message_ack');
  });

  it('requires member work tools to complete in synthetic, message, submit order', () => {
    const trace = {
      mcp_activities: [
        {
          activity_id: 'stock-1',
          sequence: 10,
          tool_name: 'synthetic_stock_snapshot',
          status: 'completed',
          source_refs: { run_id: 'member-run-1' },
        },
        {
          activity_id: 'message-1',
          sequence: 11,
          tool_name: 'message_send',
          status: 'completed',
          source_refs: { run_id: 'member-run-1' },
        },
        {
          activity_id: 'submit-1',
          sequence: 12,
          tool_name: 'board_submit',
          status: 'completed',
          source_refs: { run_id: 'member-run-1' },
        },
      ],
    };
    expect(evaluateMemberWorkTraceFacts(successfulProjection(), trace)).toEqual(
      { ok: true, failures: [] },
    );
    trace.mcp_activities[2].sequence = 9;
    expect(
      evaluateMemberWorkTraceFacts(successfulProjection(), trace).failures.map(
        (failure) => failure.code,
      ),
    ).toContain('member_work_tool_order');
  });

  it('accepts a member retry as one logical step using the latest completion', () => {
    const trace = {
      mcp_activities: [
        {
          activity_id: 'stock-1',
          sequence: 10,
          tool_name: 'synthetic_stock_snapshot',
          status: 'completed',
          source_refs: { run_id: 'member-run-1' },
        },
        {
          activity_id: 'activity-2',
          sequence: 11,
          tool_name: 'message_send',
          status: 'failed',
          source_refs: { run_id: 'member-run-1' },
        },
        {
          activity_id: 'activity-3',
          sequence: 12,
          tool_name: 'message_send',
          status: 'completed',
          source_refs: { run_id: 'member-run-1' },
        },
        {
          activity_id: 'submit-1',
          sequence: 13,
          tool_name: 'board_submit',
          status: 'completed',
          source_refs: { run_id: 'member-run-1' },
        },
      ],
    };

    expect(evaluateMemberWorkTraceFacts(successfulProjection(), trace)).toEqual(
      { ok: true, failures: [] },
    );
  });

  it('rejects a member logical step with no completed event', () => {
    const trace = {
      mcp_activities: [
        {
          activity_id: 'stock-1',
          sequence: 10,
          tool_name: 'synthetic_stock_snapshot',
          status: 'completed',
          source_refs: { run_id: 'member-run-1' },
        },
        {
          activity_id: 'activity-2',
          sequence: 11,
          tool_name: 'message_send',
          status: 'failed',
          source_refs: { run_id: 'member-run-1' },
        },
        {
          activity_id: 'submit-1',
          sequence: 12,
          tool_name: 'board_submit',
          status: 'completed',
          source_refs: { run_id: 'member-run-1' },
        },
      ],
    };

    expect(
      evaluateMemberWorkTraceFacts(successfulProjection(), trace).failures.map(
        (failure) => failure.code,
      ),
    ).toContain('member_work_message_send');
  });

  it('does not use a completed member tool from an unrelated run', () => {
    const trace = {
      mcp_activities: [
        {
          activity_id: 'stock-1',
          sequence: 10,
          tool_name: 'synthetic_stock_snapshot',
          status: 'completed',
          source_refs: { run_id: 'member-run-1' },
        },
        {
          activity_id: 'message-other-run',
          sequence: 11,
          tool_name: 'message_send',
          status: 'completed',
          source_refs: { run_id: 'other-member-run' },
        },
        {
          activity_id: 'submit-1',
          sequence: 12,
          tool_name: 'board_submit',
          status: 'completed',
          source_refs: { run_id: 'member-run-1' },
        },
      ],
    };

    expect(
      evaluateMemberWorkTraceFacts(successfulProjection(), trace).failures.map(
        (failure) => failure.code,
      ),
    ).toContain('member_work_message_send');
  });

  it.each([
    ['missing', 'missing'],
    ['malformed', 42],
  ])('rejects a %s member activity ID', (_label, activityId) => {
    const trace = completeMemberTrace();
    if (activityId === 'missing') {
      delete trace.mcp_activities[1].activity_id;
    } else {
      trace.mcp_activities[1].activity_id = activityId;
    }

    expect(
      evaluateMemberWorkTraceFacts(successfulProjection(), trace).failures.map(
        (failure) => failure.code,
      ),
    ).toContain('member_work_message_send');
  });

  it.each([
    ['missing', 'missing'],
    ['malformed', 42],
  ])('rejects a %s lead activity ID', (_label, activityId) => {
    const trace = completeLeadTrace();
    if (activityId === 'missing') {
      delete trace.mcp_activities[0].activity_id;
    } else {
      trace.mcp_activities[0].activity_id = activityId;
    }

    expect(
      evaluateLeadTerminalFacts(successfulProjection(), trace).failures.map(
        (failure) => failure.code,
      ),
    ).toContain('terminal_lead_message_ack');
  });

  it('rejects duplicate member success events for the same activity ID', () => {
    const trace = completeMemberTrace();
    trace.mcp_activities.splice(2, 0, {
      activity_id: 'message-1',
      sequence: 12,
      tool_name: 'message_send',
      status: 'completed',
      source_refs: { run_id: 'member-run-1' },
    });

    expect(
      evaluateMemberWorkTraceFacts(successfulProjection(), trace).failures.map(
        (failure) => failure.code,
      ),
    ).toContain('member_work_message_send');
  });

  it('rejects duplicate lead success events for the same activity ID', () => {
    const trace = completeLeadTrace();
    trace.mcp_activities.splice(1, 0, {
      activity_id: 'ack-1',
      sequence: 11,
      tool_name: 'message_ack',
      status: 'completed',
      source_refs: { run_id: 'lead-run-1' },
    });

    expect(
      evaluateLeadTerminalFacts(successfulProjection(), trace).failures.map(
        (failure) => failure.code,
      ),
    ).toContain('terminal_lead_message_ack');
  });

  it('rejects a member logical step completing twice with distinct activity IDs', () => {
    const trace = completeMemberTrace();
    trace.mcp_activities.splice(2, 0, {
      activity_id: 'message-2',
      sequence: 12,
      tool_name: 'message_send',
      status: 'completed',
      source_refs: { run_id: 'member-run-1' },
    });

    expect(
      evaluateMemberWorkTraceFacts(successfulProjection(), trace).failures.map(
        (failure) => failure.code,
      ),
    ).toContain('member_work_message_send');
  });

  it('rejects a masking trace with two completed message steps', () => {
    const trace = {
      mcp_activities: [
        {
          activity_id: 'stock-1',
          sequence: 20,
          tool_name: 'synthetic_stock_snapshot',
          status: 'completed',
          source_refs: { run_id: 'member-run-1' },
        },
        {
          activity_id: 'message-1',
          sequence: 10,
          tool_name: 'message_send',
          status: 'completed',
          source_refs: { run_id: 'member-run-1' },
        },
        {
          activity_id: 'message-2',
          sequence: 30,
          tool_name: 'message_send',
          status: 'completed',
          source_refs: { run_id: 'member-run-1' },
        },
        {
          activity_id: 'submit-1',
          sequence: 40,
          tool_name: 'board_submit',
          status: 'completed',
          source_refs: { run_id: 'member-run-1' },
        },
      ],
    };

    expect(
      evaluateMemberWorkTraceFacts(successfulProjection(), trace).failures.map(
        (failure) => failure.code,
      ),
    ).toContain('member_work_message_send');
  });
});
