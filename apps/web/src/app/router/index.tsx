import {
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { useEffect, useState } from 'react';

import { useAppRuntime } from '../providers';
import AppShell from '../shell/AppShell';
import { parseSessionIndex } from '../routes';
import NotFoundPage from './NotFoundPage';
import AuthPage from '../../features/account/AuthPage';
import { loadAuthIdentity } from '../../features/account/account-gateway';

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<AuthPage />} />
      <Route path="/" element={<WorkspaceRoute />} />
      {/* The conversations list is reachable both as the workspace root and
          under its own path, so a shared or typed /conversations link lands on
          the list instead of falling through to the catch-all 404. */}
      <Route path="/conversations" element={<WorkspaceRoute />} />
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
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

function WorkspaceRoute() {
  const [checked, setChecked] = useState(false);
  const navigate = useNavigate();
  const runtime = useAppRuntime();
  const location = useLocation();
  const { conversationId, workItemId, boardId, workId } = useParams<{
    conversationId?: string;
    workItemId?: string;
    boardId?: string;
    workId?: string;
  }>();
  useEffect(() => {
    let active = true;
    void loadAuthIdentity().then(
      () => {
        if (active) setChecked(true);
      },
      () => {
        if (active)
          navigate(
            `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`,
            { replace: true },
          );
      },
    );
    return () => {
      active = false;
    };
  }, [navigate]);
  if (!checked) return null;
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
