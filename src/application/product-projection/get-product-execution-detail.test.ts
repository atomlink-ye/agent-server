import { describe, expect, it, vi } from 'vitest';

import { GetProductExecutionDetail } from './get-product-execution-detail.js';
import { ProductProjectionNotFoundError } from './product-projection.js';

const workId = '00000000-0000-4000-8000-000000000901';
const workRunId = '00000000-0000-4000-8000-000000000902';
const rootTaskId = '00000000-0000-4000-8000-000000000903';
const taskId = '00000000-0000-4000-8000-000000000904';
const runId = '00000000-0000-4000-8000-000000000905';
const workItemId = '00000000-0000-4000-8000-000000000906';
const attemptId = '00000000-0000-4000-8000-000000000907';
const actorId = '00000000-0000-4000-8000-000000000908';
const timestamp = '2026-08-18T01:00:00.000Z';

const owner = { tenantId: 'tenant-1', workspaceId: 'workspace-1' };

function service(
  overrides: {
    readonly work?: unknown;
    readonly workRun?: unknown;
  } = {},
) {
  const work =
    overrides.work === undefined
      ? { id: workId, tenantId: owner.tenantId, workspaceId: owner.workspaceId }
      : overrides.work;
  const workRun =
    overrides.workRun === undefined
      ? {
          id: workRunId,
          workId,
          rootTaskId,
          boundAt: timestamp,
        }
      : overrides.workRun;
  const workIdentity = {
    findWorkById: vi.fn().mockResolvedValue(work),
    findWorkRunById: vi.fn().mockResolvedValue(workRun),
  } as any;
  const workFacts = {
    getByRootTask: vi.fn().mockResolvedValue({
      identity: {
        actors: [{ id: actorId, name: 'Researcher', source_refs: {} }],
        messages: [],
        work_items: [
          {
            id: workItemId,
            subject: 'Research supplier risk',
            description: null,
            status: 'in_progress',
            actor_id: actorId,
            dependency_ids: [],
            source_refs: {},
            attempts: [
              {
                id: attemptId,
                attempt_no: 1,
                status: 'completed',
                started_at: timestamp,
                ended_at: timestamp,
                duration_ms: 1000,
                timing_capture_status: 'captured',
                feedback_summary: null,
                feedback_capture_status: 'not_present',
                result_summary: 'Finished research.',
                result_capture_status: 'not_present',
                source_refs: { task_id: taskId },
              },
            ],
          },
        ],
      },
    }),
  } as any;
  const executionFacts = {
    listRunsByRootTask: vi.fn().mockResolvedValue([
      {
        runId,
        taskId,
        rootTaskId,
        status: 'succeeded',
        provider: 'opencode',
        model: 'model',
        resultPresent: true,
        errorCode: null,
        actorId,
        workItemId,
        startedAt: timestamp,
        endedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]),
  } as any;
  const runEvents = {
    list: vi.fn().mockResolvedValue({
      events: [
        {
          id: 'event-start',
          runId,
          sequence: 1,
          type: 'started',
          payload: {},
          createdAt: timestamp,
        },
        {
          id: 'event-text',
          runId,
          sequence: 2,
          type: 'output',
          payload: { kind: 'assistant_text', text: 'Actual provider output.' },
          createdAt: '2026-08-18T01:00:01.000Z',
        },
        {
          id: 'event-tool',
          runId,
          sequence: 3,
          type: 'output',
          payload: {
            kind: 'tool_status',
            activity_id: 'activity-1',
            category: 'read',
            status: 'completed',
            label: 'Read source',
            summary: 'Read finished',
            provider: 'opencode',
            tool_name: 'synthetic_stock_snapshot',
            detail_kind: 'read',
            detail_text: 'bounded detail',
          },
          createdAt: '2026-08-18T01:00:02.000Z',
        },
        {
          id: 'event-unknown',
          runId,
          sequence: 4,
          type: 'output',
          payload: { kind: 'provider_private_blob', secret: 'do not expose' },
          createdAt: '2026-08-18T01:00:03.000Z',
        },
      ],
      nextCursor: null,
    }),
  } as any;
  return {
    projection: new GetProductExecutionDetail(
      workIdentity,
      workFacts,
      executionFacts,
      runEvents,
    ),
    runEvents,
  };
}

describe('GetProductExecutionDetail', () => {
  it('returns only normalized safe Run events for the selected Product Attempt', async () => {
    const { projection, runEvents } = service();
    const response = await projection.execute({
      ...owner,
      workId,
      workRunId,
      attemptId,
    });

    expect(response).toEqual({
      work_id: workId,
      work_run_id: workRunId,
      work_item_id: workItemId,
      attempt_id: attemptId,
      actor_id: actorId,
      capture_scope: 'safe_run_events',
      truncated: false,
      events: [
        {
          kind: 'lifecycle',
          status: 'started',
          sequence: 1,
          created_at: timestamp,
        },
        {
          kind: 'assistant_text',
          text: 'Actual provider output.',
          sequence: 2,
          created_at: '2026-08-18T01:00:01.000Z',
        },
        {
          kind: 'tool_status',
          sequence: 3,
          created_at: '2026-08-18T01:00:02.000Z',
          activity_id: 'activity-1',
          category: 'read',
          status: 'completed',
          label: 'Read source',
          summary: 'Read finished',
          provider: 'opencode',
          tool_name: 'synthetic_stock_snapshot',
          detail_kind: 'read',
          detail_text: 'bounded detail',
          exit_code: null,
          parent_activity_id: null,
        },
        {
          kind: 'lifecycle',
          status: 'output',
          raw_type: 'provider_private_blob',
          sequence: 4,
          created_at: '2026-08-18T01:00:03.000Z',
        },
      ],
    });
    expect(JSON.stringify(response)).not.toContain(runId);
    expect(JSON.stringify(response)).not.toContain(taskId);
    expect(JSON.stringify(response)).not.toContain('secret');
    expect(runEvents.list).toHaveBeenCalledWith(runId, 0, 100);
  });

  it('does not expose an Attempt from another WorkRun scope', async () => {
    const { projection } = service({ work: null });
    await expect(
      projection.execute({ ...owner, workId, workRunId, attemptId }),
    ).rejects.toBeInstanceOf(ProductProjectionNotFoundError);
  });
});
