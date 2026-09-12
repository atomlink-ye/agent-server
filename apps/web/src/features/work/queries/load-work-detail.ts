import type {
  ProductWorkDefinitionVersionResponse,
  WorkResponse,
  WorkRunSummary,
} from '@atomlink-ye/agent-server/product-contract';

import {
  type AgentSummary,
  type AnchoredRun,
  workRunClient,
} from '../clients/work-run-client';
import { loadWorkRuns } from './load-work-runs';
import { workClient } from '../clients/work-client';
import { workDefinitionClient } from '../clients/work-definition-client';
import { ProductReadError } from '../clients/errors';
import type { NormalizedTrace } from '@/features/run-trace/normalized';

export type WorkDetailData = {
  readonly work: WorkResponse;
  readonly runs: readonly WorkRunSummary[];
  readonly run: AnchoredRun | null;
  readonly trace: NormalizedTrace | null;
  readonly selectedDefinitionVersionId: string;
  readonly definitionVersion: ProductWorkDefinitionVersionResponse | null;
  readonly currentDefinitionVersion: ProductWorkDefinitionVersionResponse | null;
};

/** Marks a missing root Work without treating missing child resources alike. */
export class WorkDetailRootNotFoundError extends Error {
  constructor() {
    super('The selected Work is not available.');
    this.name = 'WorkDetailRootNotFoundError';
  }
}

export async function loadWorkDetail(
  workId: string,
  selectedWorkRunId: string | undefined,
  preferCurrentDefinition: boolean,
  includeTrace = true,
  includeRun = true,
): Promise<WorkDetailData> {
  let work: WorkResponse;
  try {
    work = await workClient.get(workId);
  } catch (error) {
    if (
      error instanceof ProductReadError &&
      error.status === 404 &&
      error.code === 'work_not_found'
    ) {
      throw new WorkDetailRootNotFoundError();
    }
    throw error;
  }
  const runs = await loadWorkRuns(workId);
  const selectedSummary = selectedWorkRunId
    ? runs.find((run) => run.id === selectedWorkRunId)
    : runs[0];
  if (selectedWorkRunId && !selectedSummary) {
    throw new Error('The selected Product WorkRun is not available.');
  }

  const selectedDefinitionVersionId = preferCurrentDefinition
    ? work.definition_version_id
    : (selectedSummary?.definition_version_id ?? work.definition_version_id);
  const definitionPromise = workDefinitionClient.getVersion(
    selectedDefinitionVersionId,
  );
  const currentDefinitionPromise =
    selectedDefinitionVersionId === work.definition_version_id
      ? definitionPromise
      : workDefinitionClient.getVersion(work.definition_version_id);
  if (!selectedSummary || !includeRun) {
    const currentDefinitionVersion = await currentDefinitionPromise;
    return {
      work,
      runs,
      run: null,
      trace: null,
      selectedDefinitionVersionId,
      definitionVersion: await definitionPromise,
      currentDefinitionVersion,
    };
  }

  const run = await workRunClient.get(workId, selectedSummary.id);
  const definitionVersion = await definitionPromise;
  const currentDefinitionVersion = await currentDefinitionPromise;
  if (
    !('projection_status' in run) ||
    run.projection_status !== 'internally_anchored'
  ) {
    throw new Error('The Product WorkRun projection was not captured.');
  }
  if (!includeTrace) {
    return {
      work,
      runs,
      run,
      trace: null,
      selectedDefinitionVersionId,
      definitionVersion,
      currentDefinitionVersion,
    };
  }

  const trace = await workRunClient.trace(workId, selectedSummary.id);
  return {
    work,
    runs,
    run,
    trace,
    selectedDefinitionVersionId,
    definitionVersion,
    currentDefinitionVersion,
  };
}

export async function loadRunRoleSummaries(
  workId: string,
  workRunId: string,
): Promise<readonly AgentSummary[]> {
  return workRunClient.sessionTranscripts(workId, workRunId);
}

export { type AnchoredRun, type NormalizedTrace, type AgentSummary };
