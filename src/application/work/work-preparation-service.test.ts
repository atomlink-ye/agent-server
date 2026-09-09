import { describe, expect, it } from 'vitest';
import type { Work } from '../../domain/work/work.js';
import type { WorkPreparation } from '../../domain/work/work-preparation.js';
import type { WorkPreparationRepository } from '../ports/work-preparation-repository.js';
import {
  WorkPreparationService,
  WorkPreparationVersionMismatchError,
} from './work-preparation-service.js';

const accessContext = {
  tenantId: 'tenant',
  workspaceId: '00000000-0000-4000-8000-000000000001',
  principalType: 'service_account',
  principalId: 'service',
  policySnapshotVersion: 'test',
} as const;
const work: Work = {
  id: '00000000-0000-4000-8000-000000000002',
  tenantId: 'tenant',
  workspaceId: accessContext.workspaceId,
  definitionId: '00000000-0000-4000-8000-000000000003',
  currentDefinitionVersionId: '00000000-0000-4000-8000-000000000004',
  title: 'Test',
  origin: 'created',
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const preparationBase: WorkPreparation = {
  id: '00000000-0000-4000-8000-000000000005',
  tenantId: work.tenantId,
  workspaceId: work.workspaceId,
  workId: work.id,
  revision: 1,
  status: 'ready',
  definitionVersionId: work.currentDefinitionVersionId,
  schemaFingerprint: 'schema',
  candidateInput: { topic: 'x' },
  confirmedFingerprint: null,
  startIntent: null,
  workRunId: null,
  missing: [],
  ambiguities: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function repository(
  initial: WorkPreparation,
): WorkPreparationRepository & { current: WorkPreparation } {
  const state = { current: initial };
  return {
    get current() {
      return state.current;
    },
    findCurrent: async () => state.current,
    upsert: async (input) => {
      state.current = {
        ...state.current,
        revision: state.current.revision + 1,
        candidateInput: input.candidateInput,
        missing: input.missing,
        ambiguities: input.ambiguities,
        status: input.status,
      };
      return state.current;
    },
    beginConfirmation: async (input) => {
      state.current = {
        ...state.current,
        status: 'starting',
        confirmedFingerprint: input.fingerprint,
        startIntent: input.startIntent,
      };
      return state.current;
    },
    associateRun: async (input) => {
      state.current = {
        ...state.current,
        status: 'started',
        workRunId: input.workRunId,
      };
      return state.current;
    },
    findByStartIntent: async () => state.current,
  };
}

function service(repo: WorkPreparationRepository) {
  return new WorkPreparationService({
    repository: repo,
    identity: { findWorkById: async () => work },
    schemaForVersion: async () => ({
      schema: {
        type: 'object',
        properties: { topic: { type: 'string' } },
        required: ['topic'],
        additional_properties: false,
      },
    }),
    startWorkRun: {
      execute: async () => ({
        workRun: { id: '00000000-0000-4000-8000-000000000006' } as never,
        executionReceipt: { reused: false, taskId: 'task' },
      }),
    },
  });
}

describe('WorkPreparationService', () => {
  it('confirms the same preparation twice into one WorkRun', async () => {
    const repo = repository(preparationBase);
    const app = service(repo);
    const first = await app.confirm({
      owner: work,
      accessContext,
      workId: work.id,
      preparationId: preparationBase.id,
    });
    const second = await app.confirm({
      owner: work,
      accessContext,
      workId: work.id,
      preparationId: preparationBase.id,
    });
    expect('workRun' in first && first.workRun?.id).toBe(
      '00000000-0000-4000-8000-000000000006',
    );
    expect(second.workRunId).toBe('00000000-0000-4000-8000-000000000006');
  });

  it('rejects a preparation pinned to an old Definition version', async () => {
    const repo = repository({
      ...preparationBase,
      definitionVersionId: '00000000-0000-4000-8000-000000000007',
    });
    await expect(
      service(repo).confirm({
        owner: work,
        accessContext,
        workId: work.id,
        preparationId: preparationBase.id,
      }),
    ).rejects.toBeInstanceOf(WorkPreparationVersionMismatchError);
  });

  it('does not mark a candidate ready when a required schema field is missing', async () => {
    const repo = repository(preparationBase);
    const app = service(repo);
    const observed = await app.observeLead({
      owner: work,
      accessContext,
      workId: work.id,
      candidateInput: {},
    });
    expect(observed.status).toBe('collecting');
    expect(observed.missing).toContain('topic');
    await expect(
      app.confirm({
        owner: work,
        accessContext,
        workId: work.id,
        preparationId: preparationBase.id,
      }),
    ).rejects.toThrow('not ready');
  });

  it('keeps collecting when the model reports missing context despite schema-complete input', async () => {
    const repo = repository(preparationBase);
    const observed = await service(repo).observeLead({
      owner: work,
      accessContext,
      workId: work.id,
      candidateInput: { topic: 'alpha' },
      missing: ['data source', 'time range'],
    });
    expect(observed.status).toBe('collecting');
    expect(observed.missing).toEqual(['data source', 'time range']);
  });

  it('rejects confirmation when the caller has a stale preparation revision', async () => {
    const repo = repository({ ...preparationBase, revision: 2 });
    await expect(
      service(repo).confirm({
        owner: work,
        accessContext,
        workId: work.id,
        preparationId: preparationBase.id,
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ code: 'work_preparation_revision_mismatch' });
  });
});
