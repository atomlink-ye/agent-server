import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { NewWork } from './components/new-work';
import { WorkDetailPage } from './pages/WorkDetailPage';
import type { WorkListQuery } from './queries/use-work-list';
import { workRootPath } from '../../app/routes';
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
        onCreateNew={() => {
          navigate(workRootPath(returnConversationId));
          setShowNewWork(true);
        }}
        originConversationId={returnConversationId}
        selectedWorkId={selectedWorkId}
        onStatusChange={setWorkListStatus}
        onRefreshReady={handleRefreshReady}
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
          {!workUnavailable && !showNewWork && selectedWorkId ? (
            <WorkDetailPage
              workId={selectedWorkId}
              tab={workTab ?? undefined}
              selectedRunId={selectedRunId ?? undefined}
              selectedSessionIndex={selectedSessionIndex ?? undefined}
              originConversationId={returnConversationId}
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
              <h1>Work isn&apos;t available</h1>
              <p>This workspace doesn&apos;t currently offer Work execution.</p>
            </div>
          ) : isEmpty && workListFailed ? (
            <div className="work-main-empty" data-testid="work-page-error">
              <span className="work-main-icon" aria-hidden="true">
                ✓
              </span>
              <h1>Work could not be loaded</h1>
              <p>
                This is a connection problem, not a statement about the status
                of any Work.
              </p>
            </div>
          ) : isEmpty ? (
            <div className="work-main-empty">
              <span className="work-main-icon" aria-hidden="true">
                ✓
              </span>
              <h1>Choose Work</h1>
              <p>
                Select existing formal Work from the pane, or create new Work.
              </p>
              <button type="button" onClick={() => setShowNewWork(true)}>
                New Work
              </button>
            </div>
          ) : null}
        </section>
      </main>
    </>
  );
}

export default WorkPage;
