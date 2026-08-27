const terminalTaskStatuses = new Set(['completed', 'failed', 'cancelled']);

function compareActivityOrder(left, right) {
  const leftSequence = Number.isInteger(left.sequence) ? left.sequence : null;
  const rightSequence = Number.isInteger(right.sequence)
    ? right.sequence
    : null;
  if (leftSequence !== rightSequence) {
    if (leftSequence === null) return -1;
    if (rightSequence === null) return 1;
    return leftSequence - rightSequence;
  }
  return String(left.activity_id ?? '').localeCompare(
    String(right.activity_id ?? ''),
  );
}

function selectLatestCompletedActivity(activities, toolName, runId) {
  return activities
    .filter(
      (activity) =>
        activity.tool_name === toolName &&
        activity.status === 'completed' &&
        (!runId || activity.source_refs?.run_id === runId),
    )
    .map((activity, index) => ({ activity, index }))
    .sort(
      (left, right) =>
        compareActivityOrder(left.activity, right.activity) ||
        left.index - right.index,
    )
    .at(-1)?.activity;
}

function hasValidActivityIdentity(activity) {
  return (
    typeof activity.activity_id === 'string' &&
    activity.activity_id.length > 0 &&
    typeof activity.source_refs?.run_id === 'string' &&
    activity.source_refs.run_id.length > 0 &&
    Number.isInteger(activity.sequence) &&
    activity.sequence > 0
  );
}

export function acknowledgedMessagesWithoutActivation(value) {
  const messages = Array.isArray(value?.direct_messages)
    ? value.direct_messages
    : [];
  const sessions = Array.isArray(value?.sessions) ? value.sessions : [];
  return messages.filter((message) => {
    if (message.requires_ack !== true || message.status !== 'acknowledged')
      return false;
    const messageRef = `M-${message.sequence}`;
    return !sessions.some((session) =>
      session.turns?.some(
        (turn) =>
          turn.activation?.materializer ===
            'task_run_collaboration_activation_adapter' &&
          turn.activation.causes?.some(
            (cause) =>
              cause.type === 'message' && cause.message_ref === messageRef,
          ),
      ),
    );
  });
}

export function evaluateCompletionFacts(value) {
  const failures = [];
  const fail = (scope, code, expected, actual) => {
    failures.push({ scope, code, expected, actual });
  };
  const project = value?.project;
  if (!project || project.status !== 'succeeded') {
    fail(
      'collaboration',
      'team_succeeded',
      'project.status === "succeeded"',
      project?.status ?? null,
    );
  }

  for (const [key, expected] of Object.entries({
    finish_ready: true,
    all_work_accepted: true,
    no_active_attempts: true,
    all_members_idle: true,
  })) {
    if (value?.gates?.[key] !== expected) {
      fail(
        'collaboration',
        `gate_${key}`,
        `${key} === true`,
        value?.gates?.[key] ?? null,
      );
    }
  }

  const workItems = Array.isArray(value?.work_items) ? value.work_items : [];
  if (workItems.length !== 1) {
    fail(
      'collaboration',
      'work_item_count',
      'exactly one Work item',
      workItems.length,
    );
  }
  const work = workItems.find((item) => item.work_ref === 'work-1');
  if (!work || work.status !== 'accepted' || work.assignee_name !== 'member') {
    fail(
      'collaboration',
      'work_1_accepted',
      'W-1 accepted by member',
      work
        ? {
            status: work.status ?? null,
            assignee_name: work.assignee_name ?? null,
          }
        : null,
    );
  }
  const attempt = work?.attempts?.find((attempt) => attempt.attempt_no === 1);
  if (
    work?.attempts?.length !== 1 ||
    !attempt ||
    attempt.status !== 'completed' ||
    !attempt.result_summary?.includes('AGENT_TEAM_SMOKE_MEMBER_OK')
  ) {
    fail(
      'collaboration',
      'work_1_attempt',
      'W-1 attempt 1 completed with AGENT_TEAM_SMOKE_MEMBER_OK',
      attempt ?? null,
    );
  }

  const sessions = Array.isArray(value?.sessions) ? value.sessions : [];
  if (sessions.length !== 2) {
    fail(
      'collaboration',
      'participant_count',
      'exactly two Team participants (lead and member)',
      sessions.length,
    );
  }
  const memberSession = sessions.find(
    (session) => session.name === 'member' && session.role === 'member',
  );
  const memberAvailabilityTurn = memberSession?.turns?.find(
    (turn) =>
      turn.kind === 'direct_message' &&
      turn.activation?.materializer ===
        'task_run_collaboration_activation_adapter' &&
      turn.activation.causes?.some(
        (cause) => cause.type === 'work_available' && cause.work_ref === 'W-1',
      ),
  );
  if (!memberAvailabilityTurn) {
    fail(
      'assertion',
      'work_available_activation',
      'member direct_message materialized by work_available for W-1',
      memberSession?.turns ?? [],
    );
  }
  const leadSession = sessions.find(
    (session) => session.name === 'lead' && session.role === 'lead',
  );
  const leadTerminalTurn = leadSession?.turns?.find(
    (turn) =>
      turn.kind === 'lead_turn' &&
      turn.activation?.materializer ===
        'task_run_collaboration_activation_adapter' &&
      turn.activation.causes?.some((cause) => cause.type === 'final_review'),
  );
  if (!leadTerminalTurn) {
    fail(
      'assertion',
      'final_review_activation',
      'lead_turn materialized by final_review',
      leadSession?.turns ?? [],
    );
  }

  const messages = Array.isArray(value?.direct_messages)
    ? value.direct_messages
    : [];
  if (messages.length !== 1) {
    fail(
      'collaboration',
      'direct_message_count',
      'exactly one direct message',
      messages.length,
    );
  }
  const requiresAckMessages = messages.filter(
    (message) => message.requires_ack === true,
  );
  if (!requiresAckMessages.length) {
    fail(
      'collaboration',
      'requires_ack_direct_message',
      'at least one direct message with requires_ack === true',
      messages.map((message) => ({
        sequence: message.sequence ?? null,
        requires_ack: message.requires_ack ?? null,
      })),
    );
  }
  const acknowledgedMessages = requiresAckMessages.filter(
    (message) => message.status === 'acknowledged',
  );
  if (
    leadTerminalTurn &&
    acknowledgedMessages.length &&
    !acknowledgedMessages.some((message) =>
      leadTerminalTurn.activation?.causes?.some(
        (cause) =>
          cause.type === 'message' &&
          cause.message_ref === `M-${message.sequence}`,
      ),
    )
  ) {
    fail(
      'assertion',
      'terminal_activation_coalesced',
      'lead final_review activation also contains the acknowledged message cause',
      leadTerminalTurn?.activation?.causes ?? [],
    );
  }
  const isMaterializedByMessage = (message) => {
    const messageRef = `M-${message.sequence}`;
    return sessions.some((session) =>
      session.turns?.some(
        (turn) =>
          turn.activation?.materializer ===
            'task_run_collaboration_activation_adapter' &&
          turn.activation.causes?.some(
            (cause) =>
              cause.type === 'message' && cause.message_ref === messageRef,
          ),
      ),
    );
  };
  if (requiresAckMessages.length && !acknowledgedMessages.length) {
    const pendingWithoutWake = requiresAckMessages.filter(
      (message) =>
        message.status === 'pending' && !isMaterializedByMessage(message),
    );
    if (pendingWithoutWake.length) {
      fail(
        'collaboration',
        'pending_message_activation',
        'pending requires-ack message M-N materializes a participant turn with message cause M-N',
        pendingWithoutWake.map((message) => `M-${message.sequence}`),
      );
    } else {
      fail(
        'collaboration',
        'acknowledged_direct_message',
        'at least one requires-ack direct message with status acknowledged',
        messages.map((message) => ({
          sequence: message.sequence ?? null,
          status: message.status ?? null,
        })),
      );
    }
  } else if (acknowledgedMessages.length) {
    const withoutActivation = acknowledgedMessagesWithoutActivation(value);
    if (withoutActivation.length) {
      fail(
        'collaboration',
        'acknowledged_message_activation',
        'an acknowledged direct message M-N materializes a participant turn with message cause M-N',
        withoutActivation.map((message) => `M-${message.sequence}`),
      );
    }
  }

  const message = messages[0];
  if (
    message &&
    (message.sender_name !== 'member' ||
      message.recipient_name !== 'lead' ||
      message.summary !== 'AGENT_TEAM_SMOKE_DIRECT_REQUIRES_ACK')
  ) {
    fail(
      'collaboration',
      'direct_message_route',
      'member sends AGENT_TEAM_SMOKE_DIRECT_REQUIRES_ACK to lead',
      {
        sender_name: message.sender_name ?? null,
        recipient_name: message.recipient_name ?? null,
        summary: message.summary ?? null,
      },
    );
  }

  return { ok: failures.length === 0, failures };
}

export function evaluateTraceFacts(value) {
  const failures = [];
  const activities = Array.isArray(value?.mcp_activities)
    ? value.mcp_activities
    : [];
  const stockActivities = activities.filter(
    (activity) => activity.tool_name === 'synthetic_stock_snapshot',
  );
  if (
    !selectLatestCompletedActivity(stockActivities, 'synthetic_stock_snapshot')
  ) {
    failures.push({
      scope: 'assertion',
      code: 'synthetic_stock_snapshot_activity_status',
      expected:
        'synthetic_stock_snapshot has at least one completed mcp_activity',
      actual: stockActivities.map((activity) => activity.status),
    });
  }
  return { ok: failures.length === 0, failures };
}

export function evaluateMemberWorkTraceFacts(projection, trace) {
  const failures = [];
  const memberSession = Array.isArray(projection?.sessions)
    ? projection.sessions.find(
        (session) => session.name === 'member' && session.role === 'member',
      )
    : null;
  const workTurns = Array.isArray(memberSession?.turns)
    ? memberSession.turns.filter((turn) => turn.kind === 'work_attempt')
    : [];
  if (workTurns.length !== 1) {
    failures.push({
      scope: 'assertion',
      code: 'member_work_attempt_count',
      expected: 'exactly one member work_attempt turn',
      actual: workTurns.length,
    });
  }
  const workRunId = workTurns[0]?.run_id;
  const activities = Array.isArray(trace?.mcp_activities)
    ? trace.mcp_activities
    : [];
  const completedByTool = new Map();
  const invocationsByTool = new Map();
  for (const toolName of [
    'synthetic_stock_snapshot',
    'message_send',
    'board_submit',
  ]) {
    const invocations = activities.filter(
      (activity) =>
        activity.tool_name === toolName &&
        activity.source_refs?.run_id === workRunId,
    );
    const completedEvents = invocations.filter(
      (activity) => activity.status === 'completed',
    );
    const completed = selectLatestCompletedActivity(
      invocations,
      toolName,
      workRunId,
    );
    const hasInvalidActivityIdentity = invocations.some(
      (activity) => !hasValidActivityIdentity(activity),
    );
    invocationsByTool.set(toolName, invocations);
    if (!workRunId || hasInvalidActivityIdentity || !completed) {
      failures.push({
        scope: 'assertion',
        code: `member_work_${toolName}`,
        expected: `${toolName} has exactly one completed event from the member work-attempt run with non-empty string activity_id, run_id, and positive integer sequence`,
        actual: invocations.map((activity) => ({
          activity_id: activity.activity_id ?? null,
          status: activity.status ?? null,
          run_id: activity.source_refs?.run_id ?? null,
          sequence: activity.sequence ?? null,
        })),
      });
    } else {
      completedByTool.set(toolName, completed);
      if (completedEvents.length > 1) {
        failures.push({
          scope: 'assertion',
          code: `member_work_${toolName}_multiple_completions`,
          expected: `${toolName} has exactly one completed event from the member work-attempt run`,
          actual: completedEvents.map((activity) => ({
            activity_id: activity.activity_id,
            sequence: activity.sequence ?? null,
          })),
        });
      }
    }
  }
  const orderedTools = [
    'synthetic_stock_snapshot',
    'message_send',
    'board_submit',
  ];
  const sequences = orderedTools.map(
    (toolName) => completedByTool.get(toolName)?.sequence,
  );
  if (
    sequences.some((sequence) => !Number.isInteger(sequence)) ||
    sequences.some(
      (sequence, index) => index > 0 && sequence <= sequences[index - 1],
    )
  ) {
    failures.push({
      scope: 'assertion',
      code: 'member_work_tool_order',
      expected:
        'synthetic_stock_snapshot completed before message_send, then board_submit',
      actual: sequences,
    });
  }
  for (let index = 0; index < orderedTools.length - 1; index += 1) {
    const toolName = orderedTools[index];
    const laterCompletedSequences = orderedTools
      .slice(index + 1)
      .map((laterToolName) => completedByTool.get(laterToolName)?.sequence)
      .filter((sequence) => Number.isInteger(sequence));
    const lateAttempts = (invocationsByTool.get(toolName) ?? []).filter(
      (activity) =>
        Number.isInteger(activity.sequence) &&
        laterCompletedSequences.some(
          (laterSequence) => activity.sequence > laterSequence,
        ),
    );
    if (lateAttempts.length) {
      failures.push({
        scope: 'assertion',
        code: `member_work_${toolName}_attempt_after_later_step`,
        expected: `${toolName} has no attempt after a later ordered step completed`,
        actual: lateAttempts.map((activity) => ({
          activity_id: activity.activity_id ?? null,
          status: activity.status ?? null,
          sequence: activity.sequence ?? null,
        })),
      });
    }
  }
  return { ok: failures.length === 0, failures };
}

export function evaluateLeadTerminalFacts(projection, trace) {
  const failures = [];
  const leadSession = Array.isArray(projection?.sessions)
    ? projection.sessions.find(
        (session) => session.name === 'lead' && session.role === 'lead',
      )
    : null;
  const leadTurns = Array.isArray(leadSession?.turns) ? leadSession.turns : [];
  const reviewTurns = leadTurns.filter((turn) =>
    turn.activation?.causes?.some((cause) => cause.type === 'final_review'),
  );
  if (reviewTurns.length !== 1) {
    failures.push({
      scope: 'assertion',
      code: 'terminal_lead_review_count',
      expected: 'exactly one lead final_review turn',
      actual: reviewTurns.length,
    });
  }
  const terminalTurn = reviewTurns[0];
  if (terminalTurn && leadTurns[leadTurns.length - 1] !== terminalTurn) {
    failures.push({
      scope: 'assertion',
      code: 'lead_turn_after_terminal_review',
      expected: 'no lead turn after the coalesced terminal review turn',
      actual: leadTurns.map((turn) => turn.run_id ?? null),
    });
  }
  const leadRunId = terminalTurn?.run_id;
  const activities = Array.isArray(trace?.mcp_activities)
    ? trace.mcp_activities
    : [];
  for (const toolName of [
    'message_ack',
    'board_accept',
    'collaboration_finish',
  ]) {
    const invocations = activities.filter(
      (activity) =>
        activity.tool_name === toolName &&
        activity.source_refs?.run_id === leadRunId,
    );
    const completedEvents = invocations.filter(
      (activity) => activity.status === 'completed',
    );
    const completed = selectLatestCompletedActivity(
      invocations,
      toolName,
      leadRunId,
    );
    const hasInvalidActivityIdentity = invocations.some(
      (activity) => !hasValidActivityIdentity(activity),
    );
    if (!leadRunId || hasInvalidActivityIdentity || !completed) {
      failures.push({
        scope: 'assertion',
        code: `terminal_lead_${toolName}`,
        expected: `${toolName} has exactly one completed event from the terminal lead run with non-empty string activity_id, run_id, and positive integer sequence`,
        actual: invocations.map((activity) => ({
          activity_id: activity.activity_id ?? null,
          status: activity.status ?? null,
          run_id: activity.source_refs?.run_id ?? null,
        })),
      });
    } else if (completedEvents.length > 1) {
      failures.push({
        scope: 'assertion',
        code: `terminal_lead_${toolName}_multiple_completions`,
        expected: `${toolName} has exactly one completed event from the terminal lead run`,
        actual: completedEvents.map((activity) => ({
          activity_id: activity.activity_id,
          sequence: activity.sequence ?? null,
        })),
      });
    }
  }
  return { ok: failures.length === 0, failures };
}

export function classifySmokeOutcome({
  taskStatus,
  projection,
  timedOut = false,
}) {
  const evaluation = evaluateCompletionFacts(projection);
  if (!terminalTaskStatuses.has(taskStatus)) {
    if (timedOut) {
      return {
        kind: 'gate_timeout',
        taskStatus: taskStatus ?? null,
        failures: [],
      };
    }
    return { kind: 'pending', taskStatus: taskStatus ?? null, failures: [] };
  }
  if (taskStatus !== 'completed') {
    return {
      kind: 'collaboration_not_achieved',
      taskStatus,
      failures: [
        {
          scope: 'collaboration',
          code: 'root_task_terminal_status',
          expected: 'root task status "completed"',
          actual: taskStatus,
        },
        ...evaluation.failures,
      ],
    };
  }
  if (evaluation.ok) return { kind: 'success', taskStatus, failures: [] };
  const collaborationFailures = evaluation.failures.filter(
    (failure) => failure.scope === 'collaboration',
  );
  return {
    kind:
      collaborationFailures.length > 0
        ? 'collaboration_not_achieved'
        : 'assertion_failed',
    taskStatus,
    failures: evaluation.failures,
  };
}

export function formatSmokeOutcome(outcome) {
  const details = JSON.stringify({
    task_status: outcome.taskStatus ?? null,
    failures: outcome.failures,
  });
  if (outcome.kind === 'collaboration_not_achieved') {
    return `agent team smoke collaboration not achieved (root task status: ${outcome.taskStatus ?? null}): ${details}`;
  }
  if (outcome.kind === 'assertion_failed') {
    return `agent team smoke completion-line assertion failed after collaboration reached a terminal task: ${details}`;
  }
  if (outcome.kind === 'gate_timeout') {
    return `agent team smoke gate timeout before the root task reached a terminal state; this is a gate timeout, not evidence of product failure: ${details}`;
  }
  throw new Error(`Cannot format smoke outcome: ${outcome.kind}`);
}
