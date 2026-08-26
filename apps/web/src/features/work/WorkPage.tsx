import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { NewWork } from './components/new-work';
import { WorkDetailPage } from './pages/WorkDetailPage';
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
  const [showNewWork, setShowNewWork] = useState(false);

  useEffect(() => {
    if (selectedWorkId) setShowNewWork(false);
  }, [selectedWorkId]);

  const openWork = (workId: string): void => {
    setShowNewWork(false);
    navigate(workPath(workId, returnConversationId));
  };

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

  const isEmpty = !showNewWork && !selectedWorkId;

  return (
    <>
      <WorkPane
        onCreateNew={() => {
          navigate(workRootPath(returnConversationId));
          setShowNewWork(true);
        }}
        originConversationId={returnConversationId}
        selectedWorkId={selectedWorkId}
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
          {showNewWork ? (
            <NewWork originConversationId={returnConversationId} />
          ) : null}
          {!showNewWork && selectedWorkId ? (
            <WorkDetailPage
              workId={selectedWorkId}
              tab={workTab ?? undefined}
              selectedRunId={selectedRunId ?? undefined}
              selectedSessionIndex={selectedSessionIndex ?? undefined}
              originConversationId={returnConversationId}
            />
          ) : null}
          {isEmpty ? (
            <div className="work-main-empty">
              <span className="work-main-icon" aria-hidden="true">
                ✓
              </span>
              <h1>Choose a Work item</h1>
              <p>
                Select a real Work item from the pane, or create a new Work.
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
