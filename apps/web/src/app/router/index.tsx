import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
} from 'react-router-dom';

import { useAppRuntime } from '../providers';
import AppShell from '../shell/AppShell';
import { parseSessionIndex } from '../routes';

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<WorkspaceRoute />} />
      <Route
        path="/conversations/:conversationId"
        element={<WorkspaceRoute />}
      />
      <Route path="/tasks" element={<WorkspaceRoute />} />
      <Route path="/tasks/:workItemId" element={<WorkspaceRoute />} />
      <Route path="/boards" element={<WorkspaceRoute />} />
      <Route path="/boards/:boardId" element={<WorkspaceRoute />} />
      <Route path="/work" element={<WorkspaceRoute />} />
      <Route path="/work/:workId" element={<WorkspaceRoute />} />
      <Route path="/observe" element={<WorkspaceRoute />} />
      <Route path="/agents" element={<WorkspaceRoute />} />
      <Route path="/agents/:agentId" element={<WorkspaceRoute />} />
      <Route path="/files" element={<WorkspaceRoute />} />
      <Route path="/whispers" element={<WorkspaceRoute />} />
      <Route path="*" element={<Navigate replace to="/" />} />
    </Routes>
  );
}

function WorkspaceRoute() {
  const runtime = useAppRuntime();
  const location = useLocation();
  const { conversationId, workItemId, boardId, workId } = useParams<{
    conversationId?: string;
    workItemId?: string;
    boardId?: string;
    workId?: string;
  }>();
  const query = new URLSearchParams(location.search);
  const state = location.state as { returnConversationId?: unknown } | null;
  const stateReturnConversationId =
    typeof state?.returnConversationId === 'string'
      ? state.returnConversationId
      : null;
  const returnConversationId =
    query.get('from_conversation') ?? stateReturnConversationId;

  return (
    <AppShell
      {...runtime}
      routeConversationId={conversationId ?? null}
      returnConversationId={returnConversationId}
      selectedWorkItemId={workItemId ?? null}
      selectedBoardId={boardId ?? null}
      returnWorkItemId={query.get('from_task')}
      selectedRunId={query.get('run')}
      selectedSessionIndex={parseSessionIndex(query.get('session'))}
      selectedWorkId={workId ?? null}
      workTab={query.get('tab')}
    />
  );
}

export default AppRouter;
