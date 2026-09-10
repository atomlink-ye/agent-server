import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { WorkListItem } from '@atomlink-ye/agent-server/product-contract';

import { NewWork } from './components/new-work';
import {
  formatWorkListTime,
  productStatePresentation,
  resultCaptureLabel,
} from './components/work-presentation';
import { recentWorkRunSummary } from './components/run-outcome';
import { loadSessionTranscripts } from '@/features/run-trace/run-trace-gateway';
import { WorkDetailPage } from './pages/WorkDetailPage';
import type { WorkListQuery } from './queries/use-work-list';
import { workPath, workRootPath } from '../../app/routes';
import { isValidDetailId } from '../../app/router/detail-id';
import { NotFoundContent } from '../../app/router/NotFoundPage';
import { TitleBar } from '../../app/shell/TitleBar';
import { useT } from '../../i18n';
import WorkPane from './WorkPane';
import './work-page.css';

export interface WorkPageProps {
  readonly returnConversationId?: string | null;
  readonly returnWorkItemId?: string | null;
  readonly selectedWorkId?: string | null;
  readonly workTab?: string | null;
  readonly selectedRunId?: string | null;
  readonly selectedSessionIndex?: number | null;
}

export function WorkPage({
  returnConversationId = null,
  returnWorkItemId = null,
  selectedWorkId = null,
  workTab = null,
  selectedRunId = null,
  selectedSessionIndex = null,
}: WorkPageProps) {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const authoringRequest = useMemo(() => {
    const query = new URLSearchParams(location.search);
    return {
      requested: query.get('new') === '1',
      capabilityVersionId: query.get('capability'),
      definitionId: query.get('definition'),
      definitionVersionId: query.get('version'),
    };
  }, [location.search]);
  const [showNewWork, setShowNewWork] = useState(authoringRequest.requested);
  // WorkPane owns the Work list fetch; the list pane and this detail pane
  // must read the same load state, so WorkPane reports its status here
  // instead of this page racing a second, independent fetch.
  const [workListStatus, setWorkListStatus] =
    useState<WorkListQuery['status']>('loading');
  const [works, setWorks] = useState<readonly WorkListItem[]>([]);
  const [selectedLatestRunState, setSelectedLatestRunState] = useState<{
    readonly workId: string;
    readonly runId: string;
    readonly state: WorkListItem['product_state'];
  } | null>(null);
  // WorkPane owns the Work list fetch and hands its `refresh` back up here
  // once mounted, so a successful create elsewhere in this page can
  // invalidate the same list instead of leaving the nav stale until a full
  // navigation re-mounts WorkPane.
  const [refreshWorkList, setRefreshWorkList] = useState<(() => void) | null>(
    null,
  );
  const handleRefreshReady = useCallback((refresh: () => void) => {
    setRefreshWorkList(() => refresh);
  }, []);
  const openNewWork = useCallback(() => {
    navigate(workRootPath(returnConversationId));
    setShowNewWork(true);
  }, [navigate, returnConversationId]);

  useEffect(() => {
    if (selectedWorkId) setShowNewWork(false);
    else if (authoringRequest.requested) setShowNewWork(true);
  }, [selectedWorkId, authoringRequest.requested]);

  const respondInChat = (): void => {
    navigate(
      returnConversationId
        ? `/conversations/${encodeURIComponent(returnConversationId)}`
        : '/',
    );
  };

  const returnToTask = (): void => {
    if (!returnWorkItemId) return;
    navigate(`/tasks/${encodeURIComponent(returnWorkItemId)}`);
  };

  const workUnavailable = workListStatus === 'unavailable';
  const workListFailed = workListStatus === 'error';
  const invalidWorkId =
    selectedWorkId !== null && !isValidDetailId('work', selectedWorkId);
  // Invalid links have their own state. Valid selections and authoring need
  // a composed Work surface; transient list failures still allow authoring.
  const isEmpty =
    !invalidWorkId && (workUnavailable || (!showNewWork && !selectedWorkId));

  return (
    <>
      <WorkPane
        onCreateNew={openNewWork}
        originConversationId={returnConversationId}
        selectedWorkId={selectedWorkId}
        onStatusChange={setWorkListStatus}
        onRefreshReady={handleRefreshReady}
        onWorksChange={setWorks}
        selectedLatestRunState={selectedLatestRunState}
      />
      <main className="chat-panel work-main">
        <TitleBar section={t('work.title')} />
        <section
          aria-label={t('work.overview')}
          className="work-main-content scroll-region"
          data-empty={isEmpty ? 'true' : 'false'}
        >
          {returnWorkItemId ? (
            <div className="work-return-bar">
              <button type="button" onClick={returnToTask}>
                {t('work.backToTask')}
              </button>
            </div>
          ) : null}
          {!returnWorkItemId && returnConversationId ? (
            <div className="work-return-bar">
              <button type="button" onClick={respondInChat}>
                {t('work.respondInConversation')}
              </button>
            </div>
          ) : null}
          {selectedWorkId && invalidWorkId ? (
            <NotFoundContent
              title={t('work.invalidLink.title')}
              to="/work"
              linkLabel={t('work.invalidLink.back')}
              eyebrow={t('work.invalidLink.eyebrow')}
              mark="!"
              variant="detail"
            >
              {t('work.invalidLink.body')}
            </NotFoundContent>
          ) : null}
          {!invalidWorkId && !workUnavailable && showNewWork ? (
            <NewWork
              originConversationId={returnConversationId}
              initialCapabilityVersionId={authoringRequest.capabilityVersionId}
              initialDefinitionId={authoringRequest.definitionId}
              initialDefinitionVersionId={authoringRequest.definitionVersionId}
              onWorkCreated={() => refreshWorkList?.()}
            />
          ) : null}
          {!invalidWorkId &&
          !workUnavailable &&
          !showNewWork &&
          workListStatus === 'ready' ? (
            <MobileWorkPicker
              works={works}
              selectedWorkId={selectedWorkId}
              originConversationId={returnConversationId}
              onCreate={openNewWork}
            />
          ) : null}
          {!invalidWorkId &&
          !workUnavailable &&
          !showNewWork &&
          selectedWorkId ? (
            <WorkDetailPage
              key={`${selectedWorkId}:${selectedRunId ?? 'latest'}`}
              workId={selectedWorkId}
              tab={workTab ?? undefined}
              selectedRunId={selectedRunId ?? undefined}
              selectedSessionIndex={selectedSessionIndex ?? undefined}
              originConversationId={returnConversationId}
              onSelectedLatestRunState={setSelectedLatestRunState}
            />
          ) : null}
          {!invalidWorkId && isEmpty && workUnavailable ? (
            <div
              className="work-main-empty"
              data-testid="work-page-unavailable"
            >
              <span className="work-main-icon" aria-hidden="true">
                ✓
              </span>
              <h1>{t('work.unavailable.title')}</h1>
              <p>{t('work.unavailable.body')}</p>
            </div>
          ) : isEmpty && workListFailed ? (
            <div className="work-main-empty" data-testid="work-page-error">
              <span className="work-main-icon" aria-hidden="true">
                ✓
              </span>
              <h1>{t('work.loadError.title')}</h1>
              <p>{t('work.loadError.body')}</p>
              <button type="button" onClick={() => refreshWorkList?.()}>
                {t('work.tryAgain')}
              </button>
            </div>
          ) : isEmpty ? (
            <WorkLanding
              works={works}
              status={workListStatus}
              originConversationId={returnConversationId}
              onCreate={openNewWork}
            />
          ) : null}
        </section>
      </main>
    </>
  );
}

function WorkLanding({
  works,
  status,
  originConversationId,
  onCreate,
}: {
  readonly works: readonly WorkListItem[];
  readonly status: WorkListQuery['status'];
  readonly originConversationId: string | null;
  readonly onCreate: () => void;
}) {
  const t = useT();
  if (status === 'loading')
    return (
      <div className="work-main-empty work-main-empty--loading" role="status">
        <span className="work-main-icon" aria-hidden="true">
          …
        </span>
        <h1>{t('work.loading.title')}</h1>
        <p>{t('work.loading.body')}</p>
      </div>
    );

  if (works.length === 0)
    return (
      <div className="work-main-empty work-main-empty--first">
        <span className="work-main-icon" aria-hidden="true">
          +
        </span>
        <p className="eyebrow">{t('work.formalExecution')}</p>
        <h1>{t('work.start.title')}</h1>
        <p>{t('work.start.body')}</p>
        <button type="button" onClick={onCreate}>
          {t('work.create')}
        </button>
      </div>
    );

  return (
    <div className="work-landing">
      <div className="work-landing__intro">
        <p className="eyebrow">{t('work.title')}</p>
        <h1>{t('work.continue.title')}</h1>
        <p>{t('work.continue.body')}</p>
        <button type="button" onClick={onCreate}>
          {t('work.create')}
        </button>
      </div>
      <ol className="work-landing__recent" aria-label={t('work.recent')}>
        {[...works]
          .sort((left, right) => {
            const leftTime =
              left.latest_run_summary?.updated_at ?? left.updated_at;
            const rightTime =
              right.latest_run_summary?.updated_at ?? right.updated_at;
            return rightTime.localeCompare(leftTime);
          })
          .slice(0, 4)
          .map((work) => (
            <RecentWorkRow
              key={work.id}
              work={work}
              originConversationId={originConversationId}
            />
          ))}
      </ol>
    </div>
  );
}

function RecentWorkRow({
  work,
  originConversationId,
}: {
  readonly work: WorkListItem;
  readonly originConversationId: string | null;
}) {
  const t = useT();
  const latestRun = work.latest_run_summary;
  const [transcriptSummary, setTranscriptSummary] = useState<{
    readonly runId: string;
    readonly segment: string | null;
  } | null>(null);

  useEffect(() => {
    let active = true;
    setTranscriptSummary(null);
    if (!latestRun)
      return () => {
        active = false;
      };
    void loadSessionTranscripts(work.id, latestRun.id)
      .then((transcripts) => {
        if (active)
          setTranscriptSummary({
            runId: latestRun.id,
            segment: recentWorkRunSummary(transcripts.sessions),
          });
      })
      .catch(() => {
        // The capture label is the safe fallback when transcript data is not
        // available; a raw result_summary may be an incomplete provider chunk.
        if (active)
          setTranscriptSummary({ runId: latestRun.id, segment: null });
      });
    return () => {
      active = false;
    };
  }, [latestRun?.id, work.id]);

  const state = productStatePresentation(work.product_state);
  const timestamp = latestRun?.updated_at ?? work.updated_at;
  const matchingTranscript =
    latestRun && transcriptSummary?.runId === latestRun.id
      ? transcriptSummary
      : null;
  const transcriptSegment = matchingTranscript?.segment ?? null;
  const summary = latestRun
    ? (transcriptSegment ?? resultCaptureLabel(latestRun.result_capture_status))
    : t('work.reviewSetup');
  return (
    <li>
      <a href={workPath(work.id, originConversationId)}>
        {latestRun ? (
          <span
            className={`work-state-pill work-state-pill--${work.product_state}`}
          >
            {state.label}
          </span>
        ) : (
          <span className="work-landing__no-run">{t('work.noRuns')}</span>
        )}
        <strong>{work.title}</strong>
        <span className="work-landing__summary">{summary}</span>
        <time dateTime={timestamp}>
          {latestRun
            ? t('work.runAt', { time: formatWorkListTime(timestamp) })
            : t('work.updatedAt', { time: formatWorkListTime(timestamp) })}
        </time>
      </a>
    </li>
  );
}

function MobileWorkPicker({
  works,
  selectedWorkId,
  originConversationId,
  onCreate,
}: {
  readonly works: readonly WorkListItem[];
  readonly selectedWorkId: string | null;
  readonly originConversationId: string | null;
  readonly onCreate: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  return (
    <div className="work-mobile-picker">
      <label>
        <span>{t('work.title')}</span>
        <select
          aria-label={t('work.select')}
          value={selectedWorkId ?? ''}
          onChange={(event) =>
            navigate(
              event.target.value
                ? workPath(event.target.value, originConversationId)
                : workRootPath(originConversationId),
            )
          }
        >
          <option value="">{t('work.choose')}</option>
          {works.map((work) => (
            <option key={work.id} value={work.id}>
              {work.title}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={onCreate}>
        {t('work.create')}
      </button>
    </div>
  );
}

export default WorkPage;
