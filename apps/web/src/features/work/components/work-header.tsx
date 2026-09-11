import type { ReactNode } from 'react';
import type { WorkResponse } from '@atomlink-ye/agent-server/product-contract';
import type { AnchoredWorkRun } from '../clients/work-run-client';
import { workPath } from '../../../app/routes';
import { productStatePresentation } from './work-presentation';
import { useT } from '../../../i18n';

export function WorkDetailHeader({
  work,
  run,
  runOrdinal,
  originConversationId = null,
  actions,
}: {
  readonly work: WorkResponse;
  readonly run: AnchoredWorkRun | null;
  readonly runOrdinal?: number;
  readonly originConversationId?: string | null;
  readonly actions?: ReactNode;
}) {
  const t = useT();
  if (run && runOrdinal)
    return (
      <header className="work-detail-header work-run-header">
        <a href={workPath(work.id, originConversationId)} title={work.title}>
          {t('work.run.backToWork', { title: work.title })}
        </a>
        <span aria-hidden="true">›</span>
        <h1>{t('work.run.breadcrumb', { number: runOrdinal })}</h1>
        <span
          className={`work-state-pill work-state-pill--${run.work_run.product_state}`}
        >
          {productStatePresentation(run.work_run.product_state).label}
        </span>
      </header>
    );
  return (
    <header className="work-detail-header">
      <span className="work-shell-kicker">{t('work.title')}</span>
      <h1 title={work.title}>{work.title}</h1>
      <span className="work-state-pill">
        {t(work.archived_at ? 'work.record.archived' : 'work.record.active')}
      </span>
      {actions ? (
        <div className="work-detail-header__actions">{actions}</div>
      ) : null}
    </header>
  );
}
