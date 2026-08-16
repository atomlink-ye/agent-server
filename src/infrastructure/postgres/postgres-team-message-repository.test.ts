import { describe, expect, it, vi } from 'vitest';

import { PostgresTeamMessageRepository } from './postgres-team-message-repository.js';

const owner = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  principalType: 'service_account',
  principalId: 'service-1',
};

describe('PostgresTeamMessageRepository', () => {
  it('keeps stale_state for a fence that returns no team row', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const repository = new PostgresTeamMessageRepository({ query });

    await expect(
      repository.sendDirect({
        teamRunId: 'team-1',
        senderMemberRunId: 'lead-member',
        recipientMemberRunId: 'member-1',
        dedupKey: 'message-send-1',
        body: 'wake up',
        sourceTaskId: 'lead-task-1',
        sourceRunId: 'lead-run-1',
        expectedRevision: 1,
        requiresAck: true,
        owner,
      }),
    ).rejects.toMatchObject({ code: 'stale_state' });
  });

  it('uses returned rows rather than an optional driver rowCount for a fenced direct send', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: 'team-1', root_task_id: 'root-task-1' }],
      })
      .mockResolvedValueOnce({ rows: [{ ok: 1 }] })
      .mockResolvedValueOnce({
        rows: [
          { id: 'lead-member', status: 'active' },
          { id: 'member-1', status: 'starting' },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'message-1',
            team_run_id: 'team-1',
            tenant_id: owner.tenantId,
            workspace_id: owner.workspaceId,
            principal_type: owner.principalType,
            principal_id: owner.principalId,
            sequence: 1,
            sender_member_run_id: 'lead-member',
            recipient_member_run_id: 'member-1',
            work_item_id: null,
            attempt_id: null,
            about_work_item_id: null,
            reply_to_message_id: null,
            kind: 'direct',
            dedup_key: 'message-send-1',
            body: 'wake up',
            priority: 'normal',
            requires_ack: true,
            status: 'queued',
            consumed_by_task_id: null,
            source_task_id: 'lead-task-1',
            source_run_id: 'lead-run-1',
            created_at: '2026-08-16T00:00:00.000Z',
            consumed_at: null,
            acknowledged_at: null,
            cancelled_at: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    const repository = new PostgresTeamMessageRepository({ query });

    await expect(
      repository.sendDirect({
        teamRunId: 'team-1',
        senderMemberRunId: 'lead-member',
        recipientMemberRunId: 'member-1',
        dedupKey: 'message-send-1',
        body: 'wake up',
        sourceTaskId: 'lead-task-1',
        sourceRunId: 'lead-run-1',
        expectedRevision: 1,
        requiresAck: true,
        owner,
      }),
    ).resolves.toMatchObject({
      id: 'message-1',
      status: 'queued',
      requiresAck: true,
    });
  });
});
