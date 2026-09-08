import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { WorkListItem } from '@atomlink-ye/agent-server/product-contract';

import { workPath } from '../../app/routes';
import {
  formatWorkListTime,
  productStatePresentation,
} from './components/work-presentation';
import { useWorkList, type WorkListQuery } from './queries/use-work-list';
import { useT } from '../../i18n';

export interface WorkPaneProps {
  readonly onCreateNew: () => void;
  readonly selectedWorkId?: string | null;
  readonly originConversationId?: string | null;
  readonly onStatusChange?: (status: WorkListQuery['status']) => void;
  readonly onRefreshReady?: (refresh: () => void) => void;
  readonly onWorksChange?: (works: readonly WorkListItem[]) => void;
  readonly selectedLatestRunState?: {
    readonly workId: string;
    readonly runId: string;
    readonly state: WorkListItem['product_state'];
  } | null;
}

export function WorkPane({
  onCreateNew,
  selectedWorkId = null,
  originConversationId = null,
  onStatusChange,
  onRefreshReady,
  onWorksChange,
  selectedLatestRunState = null,
}: WorkPaneProps) {
  const t = useT();
  const { status, works, refresh } = useWorkList();

  // The list/detail split of a Work destination must read the same load
  // state. WorkPane owns the fetch (so tests and assistive tech can treat it
  // as the single source of truth for "is the list present?"), and reports
  // status upward so the sibling detail pane never contradicts it.
  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  // A successful Work create happens in a sibling (NewWork), not here.
  // Hand the same `refresh` this pane already uses back up to WorkPage so
  // that create path can invalidate this list instead of leaving the nav
  // stuck on a pre-create "Nothing is available yet" read.
  useEffect(() => {
    onRefreshReady?.(refresh);
  }, [refresh, onRefreshReady]);

  useEffect(() => {
    onWorksChange?.(works);
  }, [works, onWorksChange]);

  const controlsDisabled = status === 'unavailable' || status === 'error';

  return (
    <aside className="sidebar work-pane" aria-label={t('work.navigation')}>
      <div className="pane-heading">
        <div>
          <span className="eyebrow">{t('work.workspace')}</span>
          <h1>{t('work.title')}</h1>
        </div>
        <div className="work-pane-actions">
          {/* The count is only known once a load has actually succeeded. A
              non-ready state must not assert "0 Work items" alongside a
              message that says the count could not be determined. */}
          {status === 'ready' ? (
            <span
              className="pane-count"
              aria-label={t('work.itemCount', { count: works.length })}
            >
              {works.length}
            </span>
          ) : null}
          <button
            className="pane-refresh"
            type="button"
            data-testid="new-work-cta"
            aria-label={t('work.create')}
            disabled={controlsDisabled}
            onClick={onCreateNew}
          >
            +
          </button>
          <button
            className="pane-refresh"
            type="button"
            aria-label={t('work.refresh')}
            disabled={status === 'loading' || controlsDisabled}
            onClick={refresh}
          >
            ↻
          </button>
        </div>
      </div>

      {/* The list element only exists once there is a list. A non-ready state
          is a sibling placeholder, not an empty <ul> holding a status row, so
          "is the list present?" stays an honest question for both tests and
          assistive technology. */}
      {works.length === 0 && status === 'loading' ? (
        <p
          className="pane-placeholder"
          data-testid="work-list-loading"
          role="status"
          aria-live="polite"
        >
          {t('work.loadingList')}
        </p>
      ) : null}
      {works.length === 0 && status === 'unavailable' ? (
        <div
          className="pane-placeholder"
          data-testid="work-list-unavailable"
          role="status"
        >
          <p className="eyebrow">{t('work.detailUnavailable.eyebrow')}</p>
          {/* feature_unavailable means this workspace does not compose the
              Product Work surface at all. Offering Retry would be a false
              promise, so this state has no Retry control. */}
          <p>{t('work.unavailable.body')}</p>
        </div>
      ) : null}
      {works.length === 0 && status === 'error' ? (
        <div
          className="pane-placeholder"
          data-testid="work-list-error"
          role="alert"
        >
          <p className="eyebrow">{t('work.connectionInterrupted')}</p>
          {/* A failed read must not be mistaken for a statement about any
              Work's own state, and must not leak the upstream error string
              (which can be control-plane prose). The backend owns product
              state; an empty pane here means "we could not ask", not
              "nothing needs you". */}
          <p>{t('work.connectionProblem')}</p>
          <button type="button" onClick={refresh}>
            {t('work.retry')}
          </button>
        </div>
      ) : null}
      {works.length === 0 && status === 'ready' ? (
        <div
          className="pane-placeholder"
          data-testid="work-list-empty"
          role="status"
        >
          <p>{t('work.empty')}</p>
          <button type="button" onClick={onCreateNew}>
            {t('work.new')}
          </button>
        </div>
      ) : null}
      {works.length > 0 ? (
        <ul
          className="work-list"
          aria-label={t('work.items')}
          data-testid="work-list"
        >
          {works.map((work) => (
            <WorkListRow
              key={work.id}
              work={work}
              selected={selectedWorkId === work.id}
              originConversationId={originConversationId}
              stateOverride={selectedLatestRunState}
            />
          ))}
        </ul>
      ) : null}
    </aside>
  );
}

function WorkListRow({
  work,
  selected,
  originConversationId,
  stateOverride,
}: {
  readonly work: WorkListItem;
  readonly selected: boolean;
  readonly originConversationId: string | null;
  readonly stateOverride: WorkPaneProps['selectedLatestRunState'];
}) {
  const t = useT();
  const latestRun = work.latest_run_summary;
  const productState =
    stateOverride?.workId === work.id && stateOverride.runId === latestRun?.id
      ? stateOverride.state
      : work.product_state;
  const stateView = productStatePresentation(productState);
  const timestamp = latestRun?.updated_at ?? work.updated_at;
  return (
    <li>
      <Link
        aria-current={selected ? 'page' : undefined}
        className="work-list-item"
        to={workPath(work.id, originConversationId)}
      >
        <span className="work-list-mark" aria-hidden="true">
          {work.title.slice(0, 1).toUpperCase()}
        </span>
        <span className="work-list-copy">
          <strong>{work.title}</strong>
          <span className="work-list-meta">
            {latestRun ? (
              <span data-product-state={productState}>
                <span
                  aria-hidden="true"
                  className={`work-status-dot work-status-dot--${productState}`}
                />
                {stateView.label}
              </span>
            ) : (
              <span>{t('work.noRuns')}</span>
            )}
            <time dateTime={timestamp}>
              {latestRun
                ? t('work.runAt', { time: formatWorkListTime(timestamp) })
                : t('work.updatedAt', { time: formatWorkListTime(timestamp) })}
            </time>
          </span>
        </span>
      </Link>
    </li>
  );
}

export default WorkPane;
