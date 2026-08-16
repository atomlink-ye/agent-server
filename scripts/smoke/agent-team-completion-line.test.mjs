import { describe, expect, it } from 'vitest';

import {
  classifySmokeOutcome,
  evaluateCompletionFacts,
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
        assignee_name: 'builder',
        attempts: [
          {
            attempt_no: 1,
            status: 'completed',
            result_summary: 'AGENT_TEAM_SMOKE_BUILDER_OK',
          },
        ],
      },
      {
        work_ref: 'work-2',
        status: 'accepted',
        assignee_name: 'analyst',
        attempts: [
          {
            attempt_no: 1,
            status: 'completed',
            result_summary: 'AGENT_TEAM_SMOKE_ATTEMPT_1',
          },
          {
            attempt_no: 2,
            status: 'completed',
            feedback_summary: 'AGENT_TEAM_SMOKE_REWORK_REQUIRED',
            result_summary: 'AGENT_TEAM_SMOKE_MEMBER_OK',
          },
        ],
      },
    ],
    direct_messages: [
      {
        sequence: 3,
        sender_name: 'analyst',
        recipient_name: 'builder',
        summary: 'agent collaboration update',
        status: 'acknowledged',
      },
    ],
    sessions: [
      {
        name: 'analyst',
        role: 'member',
        turns: [
          {
            kind: 'direct_message',
            activation: {
              materializer: 'task_run_collaboration_activation_adapter',
              causes: [{ type: 'work_available', work_ref: 'W-2' }],
            },
          },
        ],
      },
      {
        name: 'builder',
        role: 'member',
        turns: [
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
  return evaluateCompletionFacts(projection).failures.map((failure) =>
    failure.code,
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

  it('rejects an acknowledged message that did not wake a participant', () => {
    const projection = successfulProjection();
    projection.sessions[1].turns = [];

    expect(codes(projection)).toContain('message_activation');
  });

  it('rejects a durable acknowledged message whose activation belongs to another message', () => {
    const projection = successfulProjection();
    projection.sessions[1].turns[0].activation.causes = [
      { type: 'message', message_ref: 'M-99' },
    ];

    expect(codes(projection)).toContain('message_activation');
  });

  it('rejects a collaboration with no acknowledged direct message', () => {
    const projection = successfulProjection();
    projection.direct_messages = [];

    expect(codes(projection)).toContain('acknowledged_direct_message');
  });

  it('rejects work that was not accepted', () => {
    const projection = successfulProjection();
    projection.work_items[1].status = 'submitted';

    expect(codes(projection)).toContain('work_2_accepted');
  });

  it('reports a completed collaboration with missing provenance as an assertion failure', () => {
    const projection = successfulProjection();
    projection.sessions[2].turns = [];

    expect(classifySmokeOutcome({ taskStatus: 'completed', projection })).toMatchObject({
      kind: 'assertion_failed',
      failures: [expect.objectContaining({ code: 'final_review_activation' })],
    });
  });

  it('reports a completed collaboration with an unacknowledged message as collaboration failure', () => {
    const projection = successfulProjection();
    projection.direct_messages[0].status = 'presented';

    expect(classifySmokeOutcome({ taskStatus: 'completed', projection })).toMatchObject({
      kind: 'collaboration_not_achieved',
      failures: [expect.objectContaining({ code: 'acknowledged_direct_message' })],
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
});
