import { useNavigate } from 'react-router-dom';

import { WorkDetailPage } from './pages/WorkDetailPage';
import { WorkListPage } from './pages/WorkListPage';
import { TitleBar } from '../../app/shell/TitleBar';
import './work-page.css';

export interface WorkPageProps {
  readonly returnConversationId?: string | null;
  readonly selectedWorkId?: string | null;
  readonly workTab?: string | null;
  readonly selectedRunId?: string | null;
  readonly selectedSessionIndex?: number | null;
}

export function WorkPage({
  returnConversationId = null,
  selectedWorkId = null,
  workTab = null,
  selectedRunId = null,
  selectedSessionIndex = null,
}: WorkPageProps) {
  const navigate = useNavigate();

  const respondInChat = (): void => {
    navigate(
      returnConversationId
        ? `/conversations/${encodeURIComponent(returnConversationId)}`
        : '/',
    );
  };

  if (!selectedWorkId) {
    return <WorkListPage originConversationId={returnConversationId} />;
  }

  return (
    <main className="chat-panel work-main">
      <TitleBar section="Work" />
      <section className="work-main-content" aria-label="Work overview">
        {returnConversationId ? (
          <div className="work-return-bar">
            <button type="button" onClick={respondInChat}>
              ← Respond in conversation
            </button>
          </div>
        ) : null}
        <WorkDetailPage
          workId={selectedWorkId}
          tab={workTab ?? undefined}
          selectedRunId={selectedRunId ?? undefined}
          selectedSessionIndex={selectedSessionIndex ?? undefined}
          originConversationId={returnConversationId}
        />
      </section>
    </main>
  );
}

export default WorkPage;
