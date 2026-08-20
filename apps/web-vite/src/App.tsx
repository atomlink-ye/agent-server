import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { chatCommands, initializeSession } from './api/chat';
import ChatShell from './desktop/ChatShell';
import { WorkStatusPage } from './components/work/WorkStatusPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ChatRoute />} />
      <Route path="/work/:workId" element={<WorkStatusPage />} />
      <Route path="*" element={<Navigate replace to="/" />} />
    </Routes>
  );
}

function ChatRoute() {
  const location = useLocation();
  const [startupStatus, setStartupStatus] = useState<
    'loading' | 'ready' | 'error'
  >('loading');
  const [retryAttempt, setRetryAttempt] = useState(0);
  const state = location.state as { returnConversationId?: unknown } | null;
  const returnConversationId =
    typeof state?.returnConversationId === 'string'
      ? state.returnConversationId
      : null;

  useEffect(() => {
    let active = true;
    setStartupStatus('loading');
    void initializeSession()
      .then(() => {
        if (active) setStartupStatus('ready');
      })
      .catch(() => {
        if (active) setStartupStatus('error');
      });
    return () => {
      active = false;
    };
  }, [retryAttempt]);

  if (startupStatus === 'loading') {
    return (
      <main className="work-status-page">
        <div className="work-status-content">
          <p role="status">Loading chat…</p>
        </div>
      </main>
    );
  }

  if (startupStatus === 'error') {
    return (
      <main className="work-status-page">
        <div className="work-status-content">
          <div role="alert">
            <h1>Chat is unavailable</h1>
            <p>We could not start the chat right now.</p>
          </div>
          <div className="work-status-actions">
            <button
              type="button"
              onClick={() => setRetryAttempt((attempt) => attempt + 1)}
            >
              Retry
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <ChatShell
      commands={chatCommands}
      returnConversationId={returnConversationId}
    />
  );
}
