import type { WorkResponse } from '@atomlink-ye/agent-server/product-contract';

import type { AnchoredRun } from '../clients/work-run-client';
import { workRootPath } from '../../../app/routes';
import { productStatePresentation } from './work-presentation';
import { useT } from '../../../i18n';

export function WorkDetailHeader({
  work,
  run,
  latestRunId,
  originConversationId = null,
}: {
  readonly work: WorkResponse;
  readonly run: AnchoredRun | null;
  readonly latestRunId: string | undefined;
  readonly originConversationId?: string | null;
}) {
  const t = useT();
  const runContext = !run
    ? t('work.noRuns')
    : run.work_run.id === latestRunId
      ? t('work.latestRun')
      : t('work.historicalRun');
  return (
    <>
      <p className="work-shell-breadcrumb">
        {/* This pointed at "/", which is Conversations: the Work breadcrumb
            navigated out of the Work tab entirely. Kept as a plain anchor to
            match the tab and run-list links in this same tree, which render
            without a Router in their tests. */}
        <a href={workRootPath(originConversationId)}>{t('work.myWork')}</a> / {work.title}
      </p>
      <header className="work-detail-header work-detail-header--stacked">
        <div>
          <p className="work-shell-kicker">{t('work.title')}</p>
          <h1>{work.title}</h1>
          <p className="work-detail-header__summary">
            {runContext}
            {run
              ? ` · ${productStatePresentation(run.work_run.product_state).label}`
              : ''}
          </p>
          {!run ? (
            <p className="work-detail-surface-note">
              {t('work.startRunHint')}
            </p>
          ) : run.work_run.product_state === 'complete' ? (
            <p className="work-detail-surface-note">
              {t('work.completeHint')}
            </p>
          ) : run.work_run.product_state === 'problem' ? (
            <p className="work-detail-surface-note">
              {t('work.problemHint')}
            </p>
          ) : run.work_run.product_state === 'not_captured' ? (
            <p className="work-detail-surface-note">
              {t('work.notCapturedHint')}
            </p>
          ) : (
            <p className="work-detail-surface-note">
              {t('work.activeHint')}
            </p>
          )}
        </div>
      </header>
    </>
  );
}
