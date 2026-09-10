import { useT } from '../../../i18n';
import { WORK_TABS, workTabHref, type WorkTab } from './work-presentation';

export function WorkTabs({
  activeTab,
  definitionRunId,
  runId,
  workId,
  originConversationId,
}: {
  readonly activeTab: WorkTab;
  readonly definitionRunId: string | undefined;
  readonly runId: string | undefined;
  readonly workId: string;
  readonly originConversationId?: string | null;
}) {
  const t = useT();
  return (
    <nav className="work-tabs" aria-label={t('work.detailSections')}>
      {WORK_TABS.map((tab) => {
        const targetRunId = tab.id === 'definition' ? definitionRunId : runId;
        return (
          <a
            aria-current={activeTab === tab.id ? 'page' : undefined}
            href={workTabHref(
              workId,
              tab.id,
              targetRunId,
              originConversationId,
            )}
            key={tab.id}
          >
            {t(`work.tab.${tab.id}`)}
          </a>
        );
      })}
    </nav>
  );
}
