import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { WorkListItem } from '@atomlink-ye/agent-server/product-contract';

import { workPath } from '../../app/routes';
import { loadWorkRuns } from './queries/load-work-runs';
import { useWorkList, type WorkListQuery } from './queries/use-work-list';
import {
  workDefinitionClient,
  type WorkDefinitionCatalogEntry,
} from './clients/work-definition-client';
import { useT } from '../../i18n';
import {
  formatWorkListTime,
  productStatePresentation,
} from './components/work-presentation';
import { WorkTitle } from './components/work-title';

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
  selectedLatestRunState,
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

  const controlsDisabled = status === 'unavailable' || status === 'denied';
  const orderedWorks = [...works].sort((a, b) =>
    activityTime(b).localeCompare(activityTime(a)),
  );

  return (
    <aside
      className="sidebar work-pane"
      aria-label={t('work.navigation')}
      data-work-surface
    >
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

      <div className="work-pane-scroll scroll-region">
        {/* The list element only exists once there is a list. A non-ready state
          is a sibling placeholder, not an empty <ul> holding a status row, so
          "is the list present?" stays an honest question for both tests and
          assistive technology. */}
        {works.length === 0 && status === 'loading' ? (
          <p
            className="pane-placeholder work-loading-feedback"
            data-testid="work-list-loading"
            role="status"
            aria-live="polite"
          >
            {t('work.loadingList')}
          </p>
        ) : null}
        {status === 'unavailable' ? (
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
            <Link to="/conversations">{t('work.backToConversations')}</Link>
          </div>
        ) : null}
        {status === 'denied' ? (
          <div
            className="pane-placeholder"
            data-testid="work-list-denied"
            role="status"
          >
            <p>{t('work.permission.title')}</p>
            <p>{t('work.permission.body')}</p>
            <Link to="/conversations">{t('work.backToConversations')}</Link>
          </div>
        ) : null}
        {status === 'error' ? (
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
            <p>
              {t(works.length ? 'work.staleList' : 'work.connectionProblem')}
            </p>
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
        {works.length > 0 && status !== 'unavailable' ? (
          <ul
            className="work-list"
            aria-label={t('work.items')}
            data-testid="work-list"
          >
            {orderedWorks.map((work) => (
              <WorkListRow
                key={work.id}
                work={work}
                latestState={
                  selectedLatestRunState?.workId === work.id &&
                  selectedLatestRunState.runId === work.latest_run_summary?.id
                    ? selectedLatestRunState.state
                    : work.product_state
                }
                selected={selectedWorkId === work.id}
                originConversationId={originConversationId}
              />
            ))}
          </ul>
        ) : null}
        {status === 'ready' ? <WorkCatalog /> : null}
      </div>
    </aside>
  );
}

function WorkListRow({
  work,
  selected,
  originConversationId,
  latestState,
}: {
  readonly work: WorkListItem;
  readonly selected: boolean;
  readonly latestState: WorkListItem['product_state'];
  readonly originConversationId: string | null;
}) {
  const t = useT();
  const [runCount, setRunCount] = useState<number | null>(null);
  const [countFailed, setCountFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setRunCount(null);
    setCountFailed(false);
    void loadWorkRuns(work.id).then(
      (runs) => {
        if (active) setRunCount(runs.length);
      },
      () => {
        if (active) setCountFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [work.id, work.updated_at, work.latest_run_summary?.id]);
  const state = work.latest_run_summary ? latestState : 'not_started';
  const count =
    runCount === null
      ? t(
          countFailed
            ? 'work.record.countUnavailable'
            : 'work.record.countLoading',
        )
      : t(runCount === 1 ? 'work.record.oneRun' : 'work.record.runCount', {
          count: runCount,
        });
  const timestamp = activityTime(work);
  return (
    <li>
      <Link
        aria-current={selected ? 'page' : undefined}
        className="work-list-item work-directory-row"
        data-run-state={state}
        to={workPath(work.id, originConversationId)}
        aria-label={`${work.title}. ${t(work.archived_at ? 'work.record.archived' : 'work.record.active')}. ${count}. ${t('work.latestRunState', { state: productStatePresentation(state).label })}`}
      >
        <span className="work-list-mark" aria-hidden="true">
          {state === 'problem'
            ? '!'
            : state === 'needs_you'
              ? '?'
              : state === 'running'
                ? '↻'
                : state === 'complete'
                  ? '✓'
                  : '·'}
        </span>
        <span className="work-list-copy">
          <span className="work-directory-heading">
            <WorkTitle title={work.title} />
            <span className="work-list-count" title={count}>
              {count}
            </span>
          </span>
          <span className="work-list-meta">
            <span>
              {work.archived_at
                ? t('work.record.archived')
                : work.latest_run_summary
                  ? t('work.latestRunState', {
                      state: productStatePresentation(state).label,
                    })
                  : t('work.noRuns')}
            </span>
            <time
              dateTime={timestamp}
              title={t('work.updatedAt', {
                time: formatWorkListTime(timestamp),
              })}
            >
              {formatWorkListTime(timestamp)}
            </time>
          </span>
        </span>
      </Link>
    </li>
  );
}

function activityTime(work: WorkListItem): string {
  const runTime = work.latest_run_summary?.updated_at;
  return runTime && runTime > work.updated_at ? runTime : work.updated_at;
}

export default WorkPane;

function WorkCatalog() {
  const t = useT();
  const [catalog, setCatalog] = useState<readonly WorkDefinitionCatalogEntry[]>(
    [],
  );
  useEffect(() => {
    let active = true;
    // Let the history pane commit its first paint before the independent
    // catalog fan-out begins. This keeps a long/empty catalog read from
    // delaying the existing Work list navigation.
    const timer = window.setTimeout(() => {
      void workDefinitionClient.listCatalog().then(
        (items) => {
          if (active) setCatalog(items);
        },
        () => undefined,
      );
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);

  const launchHref = (definition: WorkDefinitionCatalogEntry): string => {
    const params = new URLSearchParams({
      new: '1',
      definition: definition.definitionId,
      version: definition.definitionVersionId,
    });
    return `/work?${params.toString()}`;
  };

  if (catalog.length === 0) return null;
  return (
    <section className="work-catalog" aria-label={t('work.catalog')}>
      <div className="pane-section-heading">
        <span className="eyebrow">{t('work.catalog')}</span>
        <strong>{t('work.definitions')}</strong>
      </div>
      <ul
        className="work-list work-catalog-list"
        data-testid="work-definition-catalog"
      >
        {catalog.map((definition) => {
          return (
            <li key={definition.definitionId} className="work-catalog-card">
              <div className="work-list-item">
                <span className="work-list-mark" aria-hidden="true">
                  {definition.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="work-list-copy">
                  <strong
                    className="work-catalog-card__title"
                    title={definition.name}
                  >
                    {definition.name}
                  </strong>
                  <span className="work-list-meta work-catalog-card__meta">
                    {definition.description ? (
                      <span
                        className="work-catalog-card__description"
                        title={definition.description}
                      >
                        {definition.description}
                      </span>
                    ) : null}
                    <span className="work-catalog-card__detail">
                      {definition.composition === 'collaboration'
                        ? t('work.teamComposition')
                        : t('work.singleComposition')}
                    </span>
                  </span>
                  <span className="work-catalog-card__actions">
                    <a
                      className="work-catalog-card__create"
                      href={launchHref(definition)}
                    >
                      {t('work.create')}
                    </a>
                  </span>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
