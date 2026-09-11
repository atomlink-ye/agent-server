import { useT } from '../../../i18n';
import {
  RUN_TABS,
  WORK_TABS,
  workTabHref,
  type WorkTab,
} from './work-presentation';

export function WorkTabs({
  activeTab,
  runId,
  workId,
  originConversationId,
  preparation = false,
}: {
  readonly activeTab: WorkTab;
  readonly runId?: string;
  readonly workId: string;
  readonly originConversationId?: string | null;
  readonly preparation?: boolean;
}) {
  const t = useT();
  const tabs: readonly WorkTab[] = runId
    ? RUN_TABS
    : preparation
      ? [...WORK_TABS, 'chat']
      : WORK_TABS;
  return (
    <nav
      className="work-tabs"
      aria-label={runId ? t('work.run.sections') : t('work.detailSections')}
    >
      {tabs.map((tab) => (
        <a
          key={tab}
          aria-current={activeTab === tab ? 'page' : undefined}
          href={workTabHref(workId, tab, runId, originConversationId)}
        >
          {tab === 'chat'
            ? t(runId ? 'work.run.conversation' : 'work.record.preparation')
            : tab === 'transcript'
              ? t('work.run.trace')
              : tab === 'result'
                ? t('work.run.result')
                : tab === 'overview'
                  ? t('work.record.tab')
                  : t(`work.tab.${tab}`)}
        </a>
      ))}
    </nav>
  );
}
