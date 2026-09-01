import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiTransportError, apiTransport } from '@/api/transport';
import { workOrganizationClient } from './client';
import { readClaimState, readMentionIds } from './work-item-extensions';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const workItemId = '11111111-1111-4111-8111-111111111111';
const timestamp = '2026-09-01T00:00:00.000Z';

function workItem(extra: Record<string, unknown> = {}) {
  return {
    id: workItemId,
    workspace_id: workspaceId,
    title: 'Ship the Board',
    description: null,
    status: 'todo',
    assignee_id: null,
    mentions: [],
    created_by: 'user-1',
    source_conversation_id: null,
    source_message_id: null,
    linked_work_id: null,
    created_at: timestamp,
    updated_at: timestamp,
    ...extra,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('forward-compatible response parsing', () => {
  it('keeps fields the browser contract has not learned yet', async () => {
    vi.spyOn(apiTransport, 'request').mockResolvedValue({
      work_items: [
        {
          work_item: workItem({
            mentions: ['ari-analyst'],
            assignee_id: 'ari-analyst',
          }),
          linked_work: null,
        },
      ],
    });

    const [detail] = await workOrganizationClient.listWorkItems();

    expect(detail?.work_item.title).toBe('Ship the Board');
    expect(readMentionIds(detail!.work_item)).toEqual(['ari-analyst']);
    expect(readClaimState(detail!.work_item)).toEqual({
      claimedBy: 'ari-analyst',
      claimedAt: timestamp,
    });
  });

  it('still rejects a genuinely wrong shape', async () => {
    vi.spyOn(apiTransport, 'request').mockResolvedValue({
      work_items: [{ work_item: workItem({ status: 'nonsense' }) }],
    });

    await expect(workOrganizationClient.listWorkItems()).rejects.toThrow(
      /did not match the browser contract/u,
    );
  });

  it('still rejects a response missing a required field', async () => {
    const { title: _title, ...withoutTitle } = workItem();
    vi.spyOn(apiTransport, 'request').mockResolvedValue({
      work_item: withoutTitle,
      linked_work: null,
    });

    await expect(
      workOrganizationClient.getWorkItem(workItemId),
    ).rejects.toThrow(/did not match the browser contract/u);
  });
});

describe('claimWorkItem', () => {
  it('posts to the claim route and reads a detail response', async () => {
    const request = vi.spyOn(apiTransport, 'request').mockResolvedValue({
      work_item: workItem({ assignee_id: 'ari-analyst' }),
      moved_to_column_id: '44444444-4444-4444-8444-444444444444',
    });

    const result = await workOrganizationClient.claimWorkItem(workItemId);

    expect(request).toHaveBeenCalledWith(
      `/api/work-items/${workItemId}/claim`,
      { method: 'POST', cache: 'no-store' },
    );
    expect(result.supported).toBe(true);
    expect(result.workItem?.assignee_id).toBe('ari-analyst');
    expect(result.movedToColumnId).toBe('44444444-4444-4444-8444-444444444444');
  });

  it('reads a bare WorkItem response', async () => {
    vi.spyOn(apiTransport, 'request').mockResolvedValue(workItem());
    const result = await workOrganizationClient.claimWorkItem(workItemId);
    expect(result.workItem?.id).toBe(workItemId);
    expect(result.movedToColumnId).toBeNull();
  });

  it('reads the claim response with no board move', async () => {
    vi.spyOn(apiTransport, 'request').mockResolvedValue({
      work_item: workItem({ assignee_id: 'ari-analyst' }),
      moved_to_column_id: null,
    });
    const result = await workOrganizationClient.claimWorkItem(workItemId);
    expect(readClaimState(result.workItem!)?.claimedBy).toBe('ari-analyst');
    expect(result.movedToColumnId).toBeNull();
  });

  it('reports a claim it cannot read as supported without a WorkItem', async () => {
    vi.spyOn(apiTransport, 'request').mockResolvedValue({ ok: true });
    const result = await workOrganizationClient.claimWorkItem(workItemId);
    expect(result).toEqual({
      supported: true,
      workItem: null,
      movedToColumnId: null,
    });
  });

  it('reports claim unsupported when the surface is not composed', async () => {
    vi.spyOn(apiTransport, 'request').mockRejectedValue(
      new ApiTransportError(503, 'feature_unavailable', 'Not composed.'),
    );
    expect(await workOrganizationClient.claimWorkItem(workItemId)).toEqual({
      supported: false,
      workItem: null,
      movedToColumnId: null,
    });
  });

  it('reports claim unsupported when the route does not exist', async () => {
    vi.spyOn(apiTransport, 'request').mockRejectedValue(
      new ApiTransportError(404, 'not_found', 'No such route.'),
    );
    expect(await workOrganizationClient.claimWorkItem(workItemId)).toEqual({
      supported: false,
      workItem: null,
      movedToColumnId: null,
    });
  });

  it('surfaces a missing WorkItem as a real failure', async () => {
    vi.spyOn(apiTransport, 'request').mockRejectedValue(
      new ApiTransportError(404, 'work_item_not_found', 'Gone.'),
    );
    await expect(
      workOrganizationClient.claimWorkItem(workItemId),
    ).rejects.toThrow(/Gone/u);
  });

  it('surfaces a conflicting claim as a real failure', async () => {
    vi.spyOn(apiTransport, 'request').mockRejectedValue(
      new ApiTransportError(409, 'work_item_claim_conflict', 'Taken.'),
    );
    await expect(
      workOrganizationClient.claimWorkItem(workItemId),
    ).rejects.toThrow(/Taken/u);
  });
});
