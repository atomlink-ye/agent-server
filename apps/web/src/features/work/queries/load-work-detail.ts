import type {
  ProductWorkDefinitionVersionResponse,
  WorkResponse,
  WorkRunSummary,
} from '@atomlink-ye/agent-server/product-contract';

import {
  type AnchoredRun,
  type RoleSummary,
  workRunClient,
} from '../clients/work-run-client';
import { workClient } from '../clients/work-client';
import { workDefinitionClient } from '../clients/work-definition-client';
import type { NormalizedTrace } from '@/features/run-trace/normalized';

export type WorkDetailData = {
  readonly work: WorkResponse;
  readonly runs: readonly WorkRunSummary[];
  readonly run: AnchoredRun | null;
  readonly trace: NormalizedTrace | null;
  readonly selectedDefinitionVersionId: string;
  readonly definitionVersion: ProductWorkDefinitionVersionResponse | null;
};

export async function loadWorkDetail(
  workId: string,
  selectedRunId: string | undefined,
  preferCurrentDefinition: boolean,
  includeTrace = true,
): Promise<WorkDetailData> {
  const [work, runsResponse] = await Promise.all([
    workClient.get(workId),
    workRunClient.list(workId),
  ]);
  const runs = runsResponse.work_runs;
  const selectedSummary = selectedRunId
    ? runs.find((run) => run.id === selectedRunId)
    : runs[0];
  if (selectedRunId && !selectedSummary) {
    throw new Error('The selected Product WorkRun is not available.');
  }

  const selectedDefinitionVersionId = preferCurrentDefinition
    ? work.definition_version_id
    : (selectedSummary?.definition_version_id ?? work.definition_version_id);
  const definitionPromise = workDefinitionClient.getVersion(
    selectedDefinitionVersionId,
  );
  if (!selectedSummary) {
    return {
      work,
      runs,
      run: null,
      trace: null,
      selectedDefinitionVersionId,
      definitionVersion: await definitionPromise,
    };
  }

  const run = await workRunClient.get(workId, selectedSummary.id);
  const definitionVersion = await definitionPromise;
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
  };
}

export async function loadRunRoleSummaries(
  workId: string,
  runId: string,
): Promise<readonly RoleSummary[]> {
  return workRunClient.sessionTranscripts(workId, runId);
}

export { type AnchoredRun, type NormalizedTrace, type RoleSummary };
