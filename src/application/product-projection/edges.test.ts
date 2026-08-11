import { describe, expect, it } from 'vitest';

import {
  ExecutionEventsSchema,
  ProductAssignmentEdgeSchema,
  ProductDeclaredDependencyEdgeSchema,
  ProductFeedbackEdgeSchema,
  ProductObservedMessageEdgeSchema,
  ProductTraceEdgesSchema,
} from '../../contracts/product-projection/edges.js';
import {
  projectAssignmentEdges,
  projectDependencyEdges,
  projectFeedbackEdges,
  projectMessageEdges,
} from './edges/index.js';

const run = '00000000-0000-4000-8000-000000000001';
const task = '00000000-0000-4000-8000-000000000002';
const item = '00000000-0000-4000-8000-000000000003';
const prerequisite = '00000000-0000-4000-8000-000000000004';
const attempt = '00000000-0000-4000-8000-000000000005';
const actor = '00000000-0000-4000-8000-000000000006';
const message = '00000000-0000-4000-8000-000000000007';
const at = '2026-08-11T00:00:00.000Z';

describe('S5 product edge contracts', () => {
  it('parses every discriminated variant', () => {
    expect(
      ProductObservedMessageEdgeSchema.parse({
        kind: 'observed_message',
        guarantee: 'ordered_observation',
        message_id: message,
        sender_actor_id: null,
        recipient_actor_id: actor,
        work_item_id: item,
        attempt_id: null,
        sequence: 1,
        source_created_at: at,
        source_refs: { team_run_id: run, team_message_id: message },
      }),
    ).toBeTruthy();
    expect(
      ProductDeclaredDependencyEdgeSchema.parse({
        kind: 'declared_dependency',
        guarantee: 'declared_relation',
        dependent_work_item_id: item,
        prerequisite_work_item_id: prerequisite,
        source_created_at: at,
        source_refs: { team_run_id: run },
      }),
    ).toBeTruthy();
    expect(
      ProductAssignmentEdgeSchema.parse({
        kind: 'assignment',
        guarantee: 'derived_relation',
        work_item_id: item,
        attempt_id: attempt,
        assignee_actor_id: actor,
        source_created_at: at,
        source_refs: { team_run_id: run, task_id: task },
      }),
    ).toBeTruthy();
    expect(
      ProductFeedbackEdgeSchema.parse({
        kind: 'feedback',
        guarantee: 'derived_relation',
        work_item_id: item,
        attempt_id: attempt,
        reviewer_actor_id: null,
        source_created_at: at,
        source_refs: { team_run_id: run, task_id: task },
      }),
    ).toBeTruthy();
  });

  it('rejects sequence on every non-message variant', () => {
    const variants = [
      {
        kind: 'assignment',
        guarantee: 'derived_relation',
        work_item_id: item,
        attempt_id: attempt,
        assignee_actor_id: actor,
        source_created_at: at,
        source_refs: { team_run_id: run, task_id: task },
      },
      {
        kind: 'feedback',
        guarantee: 'derived_relation',
        work_item_id: item,
        attempt_id: attempt,
        reviewer_actor_id: null,
        source_created_at: at,
        source_refs: { team_run_id: run, task_id: task },
      },
      {
        kind: 'declared_dependency',
        guarantee: 'declared_relation',
        dependent_work_item_id: item,
        prerequisite_work_item_id: prerequisite,
        source_created_at: at,
        source_refs: { team_run_id: run },
      },
    ];
    for (const edge of variants) {
      expect(() =>
        ProductTraceEdgesSchema.parse([{ ...edge, sequence: 1 }]),
      ).toThrow();
    }
  });

  it('keeps feedback rows whose reviewer actor is absent', () => {
    const result = projectFeedbackEdges([
      {
        id: attempt,
        workItemId: item,
        attemptNo: 1,
        status: 'completed',
        assigneeActorId: actor,
        requestedByLeadTaskId: task,
        reviewerActorId: null,
        createdAt: at,
        feedbackCapture: 'present',
        resultCapture: 'present',
        sourceRefs: { teamRunId: run },
      },
    ]);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]!.reviewer_actor_id).toBeNull();
  });

  it('maps all four source fact collections without synthetic sequences', () => {
    const attemptFact = {
      id: attempt,
      workItemId: item,
      attemptNo: 1,
      status: 'completed' as const,
      assigneeActorId: actor,
      requestedByLeadTaskId: task,
      reviewerActorId: actor,
      createdAt: at,
      feedbackCapture: 'present' as const,
      resultCapture: 'present' as const,
      sourceRefs: { teamRunId: run },
    };
    const assignment = projectAssignmentEdges([attemptFact]);
    const dependency = projectDependencyEdges([
      {
        teamRunId: run,
        sourceWorkItemId: item,
        dependencyWorkItemId: prerequisite,
        createdAt: at,
      },
    ]);
    const observed = projectMessageEdges([
      {
        id: message,
        senderId: actor,
        recipientId: actor,
        workItemId: item,
        attemptId: null,
        sequence: 1,
        createdAt: at,
        senderName: null,
        recipientName: null,
        bodyCapture: 'present',
        sourceRefs: { teamRunId: run, teamMessageId: message },
      },
    ]);
    expect(assignment.edges).toHaveLength(1);
    expect(dependency.edges[0]).not.toHaveProperty('sequence');
    expect(observed.edges[0]).toHaveProperty('sequence', 1);
    expect(assignment.sourceRowKeys).toEqual([`${run}:${task}:${attempt}`]);
    expect(dependency.sourceRowKeys).toEqual([
      `${run}:${item}:${prerequisite}`,
    ]);
    expect(observed.sourceRowKeys).toEqual([`${run}:${message}`]);
  });

  it('rejects unsorted event and edge arrays', () => {
    const event = (created_at: string, run_id: string, sequence: number) => ({
      sequence,
      type: 'output' as const,
      payload_capture_status: 'not_present' as const,
      source_refs: { run_id },
      created_at,
    });
    expect(() =>
      ExecutionEventsSchema.parse([
        event(at, run, 2),
        event('2026-08-10T00:00:00.000Z', run, 1),
      ]),
    ).toThrow();
    const first = {
      kind: 'declared_dependency' as const,
      guarantee: 'declared_relation' as const,
      dependent_work_item_id: item,
      prerequisite_work_item_id: prerequisite,
      source_created_at: at,
      source_refs: { team_run_id: run },
    };
    const second = { ...first, source_created_at: '2026-08-12T00:00:00.000Z' };
    expect(() => ProductTraceEdgesSchema.parse([second, first])).toThrow();
  });
});
