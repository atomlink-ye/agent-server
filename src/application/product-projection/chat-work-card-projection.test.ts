import { describe, expect, it } from 'vitest';

import { createChatWorkCardProjection } from './chat-work-card-projection.js';

/**
 * The Chat card is the only place a Work's stage is read without a Run in
 * hand, so it is the only place that can confuse "has not started" with
 * "we could not read the status". These cases pin the difference.
 */
describe('Work Chat card stages', () => {
  it('reports a Work that has never been run as not started', async () => {
    const projection = createChatWorkCardProjection({
      workIdentity: {
        findWorkById: async () => work,
        findWorkRunById: async () => null,
        findLatestVisibleWorkRun: async () => null,
      },
      productProjection: {
        getWorkRun: async () => {
          throw new Error('a Work with no Run must not be projected as a Run');
        },
      },
    });

    await expect(
      projection.getByWorkId({
        tenantId: work.tenantId,
        workspaceId: work.workspaceId,
        workId: work.id,
      }),
    ).resolves.toEqual({
      workId: work.id,
      workRef: work.id,
      title: work.title,
      productState: 'not_started',
      problemKind: null,
      attentionReason: null,
      resultSummary: null,
      resultCaptureStatus: 'not_present',
    });
  });

  it('reports a Run that is not yet bound to its root Task as starting', async () => {
    const projection = createChatWorkCardProjection({
      workIdentity: {
        findWorkById: async () => work,
        findWorkRunById: async () => pendingRun,
        findLatestVisibleWorkRun: async () => pendingRun,
      },
      productProjection: {
        getWorkRun: async () => {
          throw new Error('an unbound Run has no Task facts to project');
        },
      },
    });

    await expect(
      projection.getByWorkId({
        tenantId: work.tenantId,
        workspaceId: work.workspaceId,
        workId: work.id,
      }),
    ).resolves.toMatchObject({
      productState: 'starting',
      problemKind: null,
      attentionReason: null,
      resultCaptureStatus: 'not_present',
    });
  });

  it('keeps a bound Run whose status cannot be read as unavailable, not a stage', async () => {
    const projection = createChatWorkCardProjection({
      workIdentity: {
        findWorkById: async () => work,
        findWorkRunById: async () => boundRun,
        findLatestVisibleWorkRun: async () => boundRun,
      },
      // A response the Product projection cannot vouch for is the one case
      // that is genuinely unavailable. It must not be softened into a stage.
      productProjection: {
        getWorkRun: async () => ({
          work: null,
          work_run: null,
          projection_status: 'not_found' as const,
          work_items: [],
          actors: [],
          messages: [],
        }),
      },
    });

    await expect(
      projection.getByWorkId({
        tenantId: work.tenantId,
        workspaceId: work.workspaceId,
        workId: work.id,
      }),
    ).rejects.toMatchObject({ name: 'ChatWorkCardUnavailableError' });
  });
});

const work = {
  id: '00000000-0000-4000-8000-000000000103',
  tenantId: 'tenant-1',
  workspaceId: '00000000-0000-4000-8000-000000000104',
  definitionId: '00000000-0000-4000-8000-000000000105',
  currentDefinitionVersionId: '00000000-0000-4000-8000-000000000106',
  title: 'Release risk review',
  origin: 'created' as const,
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:01.000Z',
};

const pendingRun = {
  id: '00000000-0000-4000-8000-000000000107',
  tenantId: work.tenantId,
  workspaceId: work.workspaceId,
  workId: work.id,
  definitionVersionId: work.currentDefinitionVersionId,
  triggerKind: 'manual' as const,
  triggerRef: 'manual-1',
  idempotencyKey: 'key-1',
  rootTaskId: null,
  expiresAt: '2026-01-01T01:00:00.000Z',
  boundAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:01.000Z',
};

const boundRun = {
  ...pendingRun,
  rootTaskId: '00000000-0000-4000-8000-000000000101',
  boundAt: '2026-01-01T00:00:00.000Z',
};
