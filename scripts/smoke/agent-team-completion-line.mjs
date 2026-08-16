const terminalTaskStatuses = new Set(['completed', 'failed', 'cancelled']);

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
  if (workItems.length !== 2) {
    fail(
      'collaboration',
      'work_item_count',
      'exactly two Work items',
      workItems.length,
    );
  }
  const builderWork = workItems.find((item) => item.work_ref === 'work-1');
  const work = workItems.find((item) => item.work_ref === 'work-2');
  if (
    !builderWork ||
    builderWork.status !== 'accepted' ||
    builderWork.assignee_name !== 'builder'
  ) {
    fail(
      'collaboration',
      'work_1_accepted',
      'W-1 accepted by builder',
      builderWork
        ? {
            status: builderWork.status ?? null,
            assignee_name: builderWork.assignee_name ?? null,
          }
        : null,
    );
  }
  const builderAttempt = builderWork?.attempts?.find(
    (attempt) => attempt.attempt_no === 1,
  );
  if (
    builderWork?.attempts?.length !== 1 ||
    !builderAttempt ||
    builderAttempt.status !== 'completed' ||
    !builderAttempt.result_summary?.includes('AGENT_TEAM_SMOKE_BUILDER_OK')
  ) {
    fail(
      'collaboration',
      'work_1_attempt',
      'W-1 attempt 1 completed with AGENT_TEAM_SMOKE_BUILDER_OK',
      builderAttempt ?? null,
    );
  }
  if (!work || work.status !== 'accepted' || work.assignee_name !== 'analyst') {
    fail(
      'collaboration',
      'work_2_accepted',
      'W-2 accepted by analyst',
      work
        ? {
            status: work.status ?? null,
            assignee_name: work.assignee_name ?? null,
          }
        : null,
    );
  }
  const attempt1 = work?.attempts?.find((attempt) => attempt.attempt_no === 1);
  const attempt2 = work?.attempts?.find((attempt) => attempt.attempt_no === 2);
  if (
    work?.attempts?.length !== 2 ||
    !attempt1 ||
    attempt1.status !== 'completed' ||
    !attempt1.result_summary?.includes('AGENT_TEAM_SMOKE_ATTEMPT_1')
  ) {
    fail(
      'collaboration',
      'work_2_attempt_1',
      'W-2 attempt 1 completed with AGENT_TEAM_SMOKE_ATTEMPT_1',
      attempt1 ?? null,
    );
  }
  if (
    !attempt2 ||
    attempt2.status !== 'completed' ||
    !attempt2.feedback_summary?.includes('AGENT_TEAM_SMOKE_REWORK_REQUIRED') ||
    !attempt2.result_summary?.includes('AGENT_TEAM_SMOKE_MEMBER_OK')
  ) {
    fail(
      'collaboration',
      'work_2_attempt_2',
      'W-2 attempt 2 completed after AGENT_TEAM_SMOKE_REWORK_REQUIRED with AGENT_TEAM_SMOKE_MEMBER_OK',
      attempt2 ?? null,
    );
  }

  const sessions = Array.isArray(value?.sessions) ? value.sessions : [];
  const analystSession = sessions.find(
    (session) => session.name === 'analyst' && session.role === 'member',
  );
  const analystAvailabilityTurn = analystSession?.turns?.find(
    (turn) =>
      turn.kind === 'direct_message' &&
      turn.activation?.materializer ===
        'task_run_collaboration_activation_adapter' &&
      turn.activation.causes?.some(
        (cause) => cause.type === 'work_available' && cause.work_ref === 'W-2',
      ),
  );
  if (!analystAvailabilityTurn) {
    fail(
      'assertion',
      'work_available_activation',
      'analyst direct_message materialized by work_available for W-2',
      analystSession?.turns ?? [],
    );
  }
  const leadSession = sessions.find(
    (session) => session.name === 'lead' && session.role === 'lead',
  );
  const leadReworkReviewTurn = leadSession?.turns?.find(
    (turn) =>
      turn.kind === 'lead_turn' &&
      turn.activation?.materializer ===
        'task_run_collaboration_activation_adapter' &&
      turn.activation.causes?.some((cause) => cause.type === 'final_review'),
  );
  if (!leadReworkReviewTurn) {
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
  if (!messages.length) {
    fail(
      'collaboration',
      'direct_message_missing',
      'at least one direct message',
      [],
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
