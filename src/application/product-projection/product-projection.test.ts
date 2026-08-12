import { describe, expect, it } from 'vitest';

import type { ExecutionRunFact } from '../ports/execution-fact-query.js';
import {
  attemptTimingForRuns,
  createProductProjection,
} from './product-projection.js';

const run = (overrides: Partial<ExecutionRunFact> = {}) =>
  ({
    runId: '00000000-0000-4000-8000-000000000001',
    taskId: '00000000-0000-4000-8000-000000000002',
    rootTaskId: '00000000-0000-4000-8000-000000000003',
    status: 'succeeded',
    provider: null,
    model: null,
    resultPresent: false,
    errorCode: null,
    actorId: null,
    workItemId: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:00:01.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
    ...overrides,
  }) as ExecutionRunFact;

describe('Product Attempt timing cardinality', () => {
  it('fails closed for zero and multiple execution runs', () => {
    expect(attemptTimingForRuns([])).toEqual({
      started_at: null,
      ended_at: null,
      duration_ms: null,
      timing_capture_status: 'not_captured',
    });
    expect(
      attemptTimingForRuns([
        run(),
        run({ runId: '00000000-0000-4000-8000-000000000004' }),
      ]),
    ).toEqual({
      started_at: null,
      ended_at: null,
      duration_ms: null,
      timing_capture_status: 'not_captured',
    });
  });

  it('derives a one-run span from run_events timing facts', () => {
    expect(attemptTimingForRuns([run()])).toEqual({
      started_at: '2026-01-01T00:00:00.000Z',
      ended_at: '2026-01-01T00:00:01.000Z',
      duration_ms: 1000,
      timing_capture_status: 'captured',
    });
  });
});

describe('Product Work list projection', () => {
  it('reuses the detail state/result derivation for the latest visible run', async () => {
    const projection = createProductProjection({
      workIdentity: {
        findWorkById: async () => work,
        findWorkRunById: async () => latestRun,
        findLatestVisibleWorkRun: async () => latestRun,
      },
      workFacts: {
        getByRootTask: async () => ({
          identity: { work_items: [], actors: [], messages: [] },
          rootTaskId,
          teamRunId,
          edges: [],
          product: {
            status: 'succeeded',
            phase: 'done',
            revision: 1,
            completionApprovalRequired: false,
            completionRequestedByRunId: null,
            approvalAccepted: false,
            finalText: 'Done',
            finalTextPresent: true,
          },
        }),
      },
      executionFacts: {
        listRunsByRootTask: async () => [run({ rootTaskId })],
        listRunEvents: async () => [],
      },
    });

    await expect(
      projection.getWorkListItem({
        tenantId: work.tenantId,
        workspaceId: work.workspaceId,
        work,
      }),
    ).resolves.toMatchObject({
      product_state: 'complete',
      latest_run_summary: {
        id: latestRun.id,
        updated_at: latestRun.updatedAt,
        result_summary: 'Done',
        result_capture_status: 'present',
      },
    });
  });

  it('fails closed to explicit missing semantics when facts are unavailable', async () => {
    const projection = createProductProjection({
      workIdentity: {
        findWorkById: async () => work,
        findWorkRunById: async () => latestRun,
        findLatestVisibleWorkRun: async () => latestRun,
      },
      workFacts: { getByRootTask: async () => null },
      executionFacts: {
        listRunsByRootTask: async () => [],
        listRunEvents: async () => [],
      },
    });

    await expect(
      projection.getWorkListItem({
        tenantId: work.tenantId,
        workspaceId: work.workspaceId,
        work,
      }),
    ).resolves.toMatchObject({
      product_state: 'not_captured',
      latest_run_summary: {
        id: latestRun.id,
        result_summary: null,
        result_capture_status: 'not_captured',
      },
    });
  });

  it('rejects a Work object outside the requested projection scope', async () => {
    const projection = createProductProjection({
      workIdentity: {
        findWorkById: async () => null,
        findWorkRunById: async () => null,
        findLatestVisibleWorkRun: async () => {
          throw new Error('must not query foreign Work runs');
        },
      },
      workFacts: { getByRootTask: async () => null },
      executionFacts: {
        listRunsByRootTask: async () => [],
        listRunEvents: async () => [],
      },
    });

    await expect(
      projection.getWorkListItem({
        tenantId: 'another-tenant',
        workspaceId: work.workspaceId,
        work,
      }),
    ).rejects.toMatchObject({ name: 'ProductProjectionNotFoundError' });
  });
});

const rootTaskId = '00000000-0000-4000-8000-000000000101';
const teamRunId = '00000000-0000-4000-8000-000000000102';
const work = {
  id: '00000000-0000-4000-8000-000000000103',
  tenantId: 'tenant-1',
  workspaceId: '00000000-0000-4000-8000-000000000104',
  definitionId: '00000000-0000-4000-8000-000000000105',
  currentDefinitionVersionId: '00000000-0000-4000-8000-000000000106',
  title: 'Work',
  origin: 'created' as const,
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:01.000Z',
};
const latestRun = {
  id: '00000000-0000-4000-8000-000000000107',
  tenantId: work.tenantId,
  workspaceId: work.workspaceId,
  workId: work.id,
  definitionVersionId: work.currentDefinitionVersionId,
  triggerKind: 'manual' as const,
  triggerRef: 'manual-1',
  idempotencyKey: 'key-1',
  rootTaskId,
  expiresAt: '2026-01-01T01:00:00.000Z',
  boundAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:01.000Z',
};
