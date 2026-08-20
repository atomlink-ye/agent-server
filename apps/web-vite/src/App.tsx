import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { chatCommands } from './api/chat';
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
  const state = location.state as { returnConversationId?: unknown } | null;
  const returnConversationId =
    typeof state?.returnConversationId === 'string'
      ? state.returnConversationId
      : null;
  return (
    <ChatShell
      commands={chatCommands}
      returnConversationId={returnConversationId}
    />
  );
}
