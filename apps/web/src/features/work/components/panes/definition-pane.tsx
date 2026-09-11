import type { WorkDetailData } from '../../queries/load-work-detail';
import { DefinitionPanel } from '../definition-panel';

export function DefinitionPane({
  data,
  workId,
  selectedWorkRunId,
  originConversationId,
}: {
  readonly data: WorkDetailData;
  readonly workId: string;
  readonly selectedWorkRunId?: string;
  readonly originConversationId?: string | null;
}) {
  return (
    <DefinitionPanel
      currentWorkVersionId={data.work.definition_version_id}
      editable={
        !selectedWorkRunId &&
        data.selectedDefinitionVersionId === data.work.definition_version_id
      }
      selectedVersionId={data.selectedDefinitionVersionId}
      version={data.definitionVersion}
      workDefinitionId={data.work.definition_id}
      workId={workId}
      originConversationId={originConversationId}
    />
  );
}
