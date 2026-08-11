import { describe, expect, it, vi } from 'vitest';

import { PostgresWorkProjectionFactsQuery } from './postgres-work-projection-facts-query.js';

describe('PostgresWorkProjectionFactsQuery S5 source facts', () => {
  it('preserves source ordering, composite dependency identity, and attempt lineage', async () => {
    const results = [
      { rows: [{ id: 'team-1', root_task_id: 'root-1' }] },
      { rows: [{ id: 'actor-1', team_run_id: 'team-1', name: 'Lead' }] },
      {
        rows: [
          {
            id: 'work-1',
            team_run_id: 'team-1',
            subject: 'Work',
            description: null,
            status: 'in_progress',
            owner_member_id: 'actor-1',
          },
        ],
      },
      {
        rows: [
          {
            id: 'attempt-1',
            work_item_id: 'work-1',
            team_run_id: 'team-1',
            attempt_no: 1,
            status: 'failed',
            assignee_member_id: 'actor-1',
            requested_by_lead_task_id: 'lead-task-1',
            reviewer_member_id: null,
            created_at: '2026-08-11T00:01:00.000Z',
            feedback_present: true,
            result_present: true,
            execution_task_id: null,
          },
        ],
      },
      {
        rows: [
          {
            team_run_id: 'team-1',
            work_item_id: 'work-1',
            depends_on_work_item_id: 'work-0',
            created_at: '2026-08-11T00:00:30.000Z',
          },
        ],
      },
      {
        rows: [
          {
            id: 'message-1',
            team_run_id: 'team-1',
            sequence: 7,
            sender_member_run_id: null,
            recipient_member_run_id: 'actor-1',
            work_item_id: 'work-1',
            attempt_id: 'attempt-1',
            kind: 'direct',
            status: 'delivered',
            consumed_task_id: null,
            scoped_task_id: null,
            body_present: true,
            created_at: '2026-08-11T00:02:00.000Z',
          },
        ],
      },
    ];
    const query = vi.fn(async () => results.shift() ?? { rows: [] });
    const facts = new PostgresWorkProjectionFactsQuery({ query });

    const result = await facts.getByRootTask(
      { tenantId: 'tenant-1', workspaceId: 'workspace-1' },
      'root-1',
    );

    expect(result?.workItems[0]?.attempts[0]).toEqual(
      expect.objectContaining({
        assigneeActorId: 'actor-1',
        requestedByLeadTaskId: 'lead-task-1',
        reviewerActorId: null,
        createdAt: '2026-08-11T00:01:00.000Z',
      }),
    );
    expect(result?.dependencies).toEqual([
      {
        teamRunId: 'team-1',
        sourceWorkItemId: 'work-1',
        dependencyWorkItemId: 'work-0',
        createdAt: '2026-08-11T00:00:30.000Z',
      },
    ]);
    expect(result?.messages[0]).toEqual(
      expect.objectContaining({
        sequence: 7,
        workItemId: 'work-1',
        attemptId: 'attempt-1',
        createdAt: '2026-08-11T00:02:00.000Z',
      }),
    );
  });
});
