import { Link } from 'react-router-dom';

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
    : [
        ...WORK_TABS,
        ...(preparation ? ['chat' as const] : []),
        ...(activeTab === 'artifacts' ? ['artifacts' as const] : []),
      ];
  return (
    <nav
      className="work-tabs"
      aria-label={
        runId ? t('work.scope.runSections') : t('work.detailSections')
      }
    >
      {tabs.map((tab) => (
        <Link
          key={tab}
          aria-current={activeTab === tab ? 'page' : undefined}
          to={workTabHref(workId, tab, runId, originConversationId)}
        >
          {tab === 'chat'
            ? t(runId ? 'work.run.conversation' : 'work.record.preparation')
            : tab === 'transcript'
              ? t('work.scope.activity')
              : tab === 'result'
                ? t('work.scope.output')
                : tab === 'overview'
                  ? t('work.scope.history')
                  : tab === 'definition'
                    ? t(
                        runId
                          ? 'work.definitionUsed'
                          : 'work.record.definition',
                      )
                    : t('work.scope.filesUnavailable')}
        </Link>
      ))}
    </nav>
  );
}
