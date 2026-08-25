import { describe, expect, it } from 'vitest';

import { createProductProjection } from './product-projection.js';
import { SERVER_AUTHORIZED_TEAM_MCP_CATALOG } from '../../contracts/product-projection/edges.js';
import type { Work } from '../../domain/work/work.js';
import type { WorkRun } from '../../domain/work/work-run.js';

const tenantId = 'tenant-a';
const workspaceId = '11111111-1111-4111-8111-111111111111';
const workId = '22222222-2222-4222-8222-222222222222';
const workRunId = '33333333-3333-4333-8333-333333333333';
const rootTaskId = '44444444-4444-4444-8444-444444444444';
const runId = '55555555-5555-4555-8555-555555555555';
const definitionId = '66666666-6666-4666-8666-666666666666';
const definitionVersionId = '77777777-7777-4777-8777-777777777777';
const at = '2026-08-16T00:00:00.000Z';

const work: Work = {
  id: workId,
  tenantId,
  workspaceId,
  definitionId,
  currentDefinitionVersionId: definitionVersionId,
  title: 'Single Agent research',
  origin: 'created',
  archivedAt: null,
  createdAt: at,
  updatedAt: at,
};

const workRun: WorkRun = {
  id: workRunId,
  tenantId,
  workspaceId,
  workId,
  definitionVersionId,
  triggerKind: 'manual',
  triggerRef: 'market research',
  idempotencyKey: 'idem',
  rootTaskId,
  expiresAt: '2026-08-16T01:00:00.000Z',
  boundAt: at,
  createdAt: at,
  updatedAt: at,
};

describe('ProductProjection single-Agent Work', () => {
  it('projects WorkRun and Run Trace from execution facts without a TeamRun', async () => {
    let mcpProvenance: string | null = null;
    const projection = createProductProjection({
      workIdentity: {
        findWorkById: async () => work,
        findWorkRunById: async () => workRun,
        findLatestVisibleWorkRun: async () => workRun,
      },
      workFacts: { getByRootTask: async () => null },
      executionFacts: {
        listRunsByRootTask: async () => [
          {
            runId,
            taskId: rootTaskId,
            rootTaskId,
            status: 'succeeded',
            provider: 'opencode',
            model: 'free-model',
            resultPresent: true,
            errorCode: null,
            actorId: null,
            workItemId: null,
            startedAt: at,
            endedAt: '2026-08-16T00:00:01.000Z',
            createdAt: at,
            updatedAt: '2026-08-16T00:00:01.000Z',
          },
        ],
        listRunEvents: async () => [
          {
            id: '88888888-8888-4888-8888-888888888888',
            runId,
            sequence: 1,
            type: 'succeeded',
            payloadPresent: false,
            taskId: rootTaskId,
            rootTaskId,
            actorId: null,
            workItemId: null,
            activityId: null,
            activityKind: null,
            activityCategory: null,
            activityStatus: null,
            toolName: null,
            provenance: null,
            toolIdentityCaptureStatus: null,
            responseObserved: null,
            createdAt: '2026-08-16T00:00:01.000Z',
          },
          ...(mcpProvenance
            ? [
                {
                  id: '99999999-9999-4999-8999-999999999999',
                  runId,
                  sequence: 2,
                  type: 'output' as const,
                  payloadPresent: true,
                  taskId: rootTaskId,
                  rootTaskId,
                  actorId: null,
                  workItemId: null,
                  activityId: 'activity-1',
                  activityKind: 'tool_status' as const,
                  activityCategory: 'other',
                  activityStatus: 'completed',
                  toolName: 'synthetic_stock_snapshot',
                  provenance: mcpProvenance,
                  toolIdentityCaptureStatus: 'present' as const,
                  responseObserved: false,
                  createdAt: '2026-08-16T00:00:02.000Z',
                },
              ]
            : []),
        ],
      },
    });

    const detail = await projection.getWorkRun({
      tenantId,
      workspaceId,
      workId,
      workRunId,
    });
    if (!('projection_status' in detail) || detail.work_run === null)
      throw new Error('expected captured single-Agent WorkRun projection');
    expect(detail.projection_status).toBe('internally_anchored');
    expect(detail.work_run.product_state).toBe('complete');
    expect(detail.work_items).toEqual([]);
    expect(detail.actors).toEqual([]);
    expect(detail.messages).toEqual([]);

    const trace = await projection.getRunTrace({
      tenantId,
      workspaceId,
      workId,
      workRunId,
    });
    if (!('projection_status' in trace) || trace.work_run === null)
      throw new Error('expected captured single-Agent Run Trace projection');
    expect(trace.work_run.product_state).toBe('complete');
    expect(trace.runs).toHaveLength(1);
    expect(trace.runs[0]?.source_refs).toMatchObject({
      root_task_id: rootTaskId,
      task_id: rootTaskId,
      run_id: runId,
    });
    expect(trace.events).toHaveLength(1);
    expect(trace.edges).toEqual([]);
    expect(trace.mcp_activities).toEqual([]);

    mcpProvenance = SERVER_AUTHORIZED_TEAM_MCP_CATALOG;
    const authorized = await projection.getRunTrace({
      tenantId,
      workspaceId,
      workId,
      workRunId,
    });
    if (!('projection_status' in authorized) || authorized.work_run === null)
      throw new Error('expected captured single-Agent Run Trace projection');
    expect(authorized.mcp_activities).toHaveLength(1);
    expect(authorized.mcp_activities[0]?.provenance).toBe(
      SERVER_AUTHORIZED_TEAM_MCP_CATALOG,
    );
    expect(authorized.mcp_activities[0]?.tool_name).toBe(
      'synthetic_stock_snapshot',
    );

    mcpProvenance = `${SERVER_AUTHORIZED_TEAM_MCP_CATALOG}x`;
    const rejected = await projection.getRunTrace({
      tenantId,
      workspaceId,
      workId,
      workRunId,
    });
    if (!('projection_status' in rejected) || rejected.work_run === null)
      throw new Error('expected captured single-Agent Run Trace projection');
    expect(rejected.mcp_activities).toEqual([]);
  });
});
