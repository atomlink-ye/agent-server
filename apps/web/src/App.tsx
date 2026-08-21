import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';

import { chatCommands } from './api/chat';
import ChatShell from './desktop/ChatShell';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<WorkspaceRoute />} />
      <Route path="/work" element={<WorkspaceRoute />} />
      <Route path="/work/:workId" element={<WorkspaceRoute />} />
      <Route path="*" element={<Navigate replace to="/" />} />
    </Routes>
  );
}

function WorkspaceRoute() {
  const location = useLocation();
  const { workId } = useParams<{ workId: string }>();
  const state = location.state as { returnConversationId?: unknown } | null;
  const returnConversationId =
    typeof state?.returnConversationId === 'string' ? state.returnConversationId : null;
  const query = new URLSearchParams(location.search);

  return (
    <ChatShell
      commands={chatCommands}
      returnConversationId={returnConversationId}
      selectedRunId={query.get('run')}
      selectedSessionIndex={query.get('session')}
      selectedWorkId={workId ?? null}
      workTab={query.get('tab')}
    />
  );
}
