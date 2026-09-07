import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { WorkListItem } from '@atomlink-ye/agent-server/product-contract';

import { NewWork } from './components/new-work';
import {
  formatWorkListTime,
  latestRunSummary,
  productStatePresentation,
} from './components/work-presentation';
import { WorkDetailPage } from './pages/WorkDetailPage';
import type { WorkListQuery } from './queries/use-work-list';
import { workPath, workRootPath } from '../../app/routes';
import { TitleBar } from '../../app/shell/TitleBar';
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
  const navigate = useNavigate();
  const location = useLocation();
  const authoringRequest = useMemo(() => {
    const query = new URLSearchParams(location.search);
    return {
      requested: query.get('new') === '1',
      agentId: query.get('agent'),
      capabilityVersionId: query.get('capability'),
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
  // Unavailable must win over any requested authoring or selection state: a
  // workspace that does not compose the Work surface cannot honor "start new
  // Work" (including the ?new=1 golden-path deep link) or "open this Work",
  // so the centred placeholder applies whenever Work is unavailable, not
  // only when nothing else is selected. A transport blip (workListFailed)
  // must NOT gate authoring the same way, since a retry there can succeed.
  const isEmpty = workUnavailable || (!showNewWork && !selectedWorkId);

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
        <TitleBar section="Work" />
        <section
          aria-label="Work overview"
          className="work-main-content"
          data-empty={isEmpty ? 'true' : 'false'}
        >
          {returnWorkItemId ? (
            <div className="work-return-bar">
              <button type="button" onClick={returnToTask}>
                ← Back to Task
              </button>
            </div>
          ) : null}
          {!returnWorkItemId && returnConversationId ? (
            <div className="work-return-bar">
              <button type="button" onClick={respondInChat}>
                ← Respond in conversation
              </button>
            </div>
          ) : null}
          {!workUnavailable && showNewWork ? (
            <NewWork
              originConversationId={returnConversationId}
              initialAgentId={authoringRequest.agentId}
              initialCapabilityVersionId={authoringRequest.capabilityVersionId}
              onWorkCreated={() => refreshWorkList?.()}
            />
          ) : null}
          {!workUnavailable && !showNewWork && workListStatus === 'ready' ? (
            <MobileWorkPicker
              works={works}
              selectedWorkId={selectedWorkId}
              originConversationId={returnConversationId}
              onCreate={openNewWork}
            />
          ) : null}
          {!workUnavailable && !showNewWork && selectedWorkId ? (
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
          {isEmpty && workUnavailable ? (
            <div
              className="work-main-empty"
              data-testid="work-page-unavailable"
            >
              <span className="work-main-icon" aria-hidden="true">
                ✓
              </span>
              <h1>Work isn&apos;t set up here</h1>
              <p>This workspace doesn&apos;t have Work execution enabled.</p>
            </div>
          ) : isEmpty && workListFailed ? (
            <div className="work-main-empty" data-testid="work-page-error">
              <span className="work-main-icon" aria-hidden="true">
                ✓
              </span>
              <h1>Work could not be loaded</h1>
              <p>
                We couldn&apos;t retrieve Work right now. Try again when the
                connection is ready.
              </p>
              <button type="button" onClick={() => refreshWorkList?.()}>
                Try again
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
  if (status === 'loading')
    return (
      <div className="work-main-empty work-main-empty--loading" role="status">
        <span className="work-main-icon" aria-hidden="true">
          …
        </span>
        <h1>Loading your Work</h1>
        <p>Checking the current objectives and their latest activity.</p>
      </div>
    );

  if (works.length === 0)
    return (
      <div className="work-main-empty work-main-empty--first">
        <span className="work-main-icon" aria-hidden="true">
          +
        </span>
        <p className="eyebrow">Formal execution</p>
        <h1>Start a piece of Work</h1>
        <p>
          Define an objective, choose its execution setup, then start a Run when
          it is ready.
        </p>
        <button type="button" onClick={onCreate}>
          Create Work
        </button>
      </div>
    );

  return (
    <div className="work-landing">
      <div className="work-landing__intro">
        <p className="eyebrow">Work</p>
        <h1>Choose where to continue</h1>
        <p>
          Open a recent objective to review its Run, trace, transcript, or
          definition.
        </p>
        <button type="button" onClick={onCreate}>
          Create Work
        </button>
      </div>
      <ol className="work-landing__recent" aria-label="Recent Work">
        {[...works]
          .sort((left, right) => {
            const leftTime =
              left.latest_run_summary?.updated_at ?? left.updated_at;
            const rightTime =
              right.latest_run_summary?.updated_at ?? right.updated_at;
            return rightTime.localeCompare(leftTime);
          })
          .slice(0, 4)
          .map((work) => {
            const latestRun = work.latest_run_summary;
            const state = productStatePresentation(work.product_state);
            const timestamp = latestRun?.updated_at ?? work.updated_at;
            return (
              <li key={work.id}>
                <a href={workPath(work.id, originConversationId)}>
                  {latestRun ? (
                    <span
                      className={`work-state-pill work-state-pill--${work.product_state}`}
                    >
                      {state.label}
                    </span>
                  ) : (
                    <span className="work-landing__no-run">No runs yet</span>
                  )}
                  <strong>{work.title}</strong>
                  <span className="work-landing__summary">
                    {latestRun
                      ? latestRunSummary(work)
                      : 'Open Work to review its setup.'}
                  </span>
                  <time dateTime={timestamp}>
                    {latestRun
                      ? `Run ${formatWorkListTime(timestamp)}`
                      : `Updated ${formatWorkListTime(timestamp)}`}
                  </time>
                </a>
              </li>
            );
          })}
      </ol>
    </div>
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
  const navigate = useNavigate();
  return (
    <div className="work-mobile-picker">
      <label>
        <span>Work</span>
        <select
          aria-label="Select Work"
          value={selectedWorkId ?? ''}
          onChange={(event) =>
            navigate(
              event.target.value
                ? workPath(event.target.value, originConversationId)
                : workRootPath(originConversationId),
            )
          }
        >
          <option value="">Choose Work</option>
          {works.map((work) => (
            <option key={work.id} value={work.id}>
              {work.title}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={onCreate}>
        Create Work
      </button>
    </div>
  );
}

export default WorkPage;
