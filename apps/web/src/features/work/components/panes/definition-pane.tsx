import type { WorkDetailData } from '../../queries/load-work-detail';
import { useT } from '../../../../i18n';
import { DefinitionPanel } from '../definition-panel';

export function DefinitionPane({
  data,
  workId,
  selectedRunId,
  originConversationId,
}: {
  readonly data: WorkDetailData;
  readonly workId: string;
  readonly selectedRunId?: string;
  readonly originConversationId?: string | null;
}) {
  const t = useT();
  return (
    <section
      className="work-definition-scope"
      aria-label={t(
        selectedRunId
          ? 'work.scope.pinnedDefinition'
          : 'work.scope.currentDefinition',
      )}
    >
      <h2>
        {t(
          selectedRunId
            ? 'work.scope.pinnedDefinition'
            : 'work.scope.currentDefinition',
        )}
      </h2>
      <DefinitionPanel
        currentWorkVersionId={data.work.definition_version_id}
        editable={
          !selectedRunId &&
          data.selectedDefinitionVersionId === data.work.definition_version_id
        }
        selectedVersionId={data.selectedDefinitionVersionId}
        version={data.definitionVersion}
        workDefinitionId={data.work.definition_id}
        workId={workId}
        originConversationId={originConversationId}
      />
    </section>
  );
}
