import { Route, Routes, useLocation, useParams } from 'react-router-dom';

import { useAppRuntime } from '../providers';
import AppShell from '../shell/AppShell';
import { parseSessionIndex } from '../routes';
import NotFoundPage, { NotFoundContent } from './NotFoundPage';

const UUID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/iu;
const AGENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

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
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

function WorkspaceRoute() {
  const runtime = useAppRuntime();
  const location = useLocation();
  const { conversationId, workItemId, boardId, workId, agentId } = useParams<{
    conversationId?: string;
    workItemId?: string;
    boardId?: string;
    workId?: string;
    agentId?: string;
  }>();
  const invalidDetail = [
    { resource: 'Task', id: workItemId, to: '/tasks', list: 'Tasks' },
    { resource: 'Board', id: boardId, to: '/boards', list: 'Boards' },
    { resource: 'Work', id: workId, to: '/work', list: 'Work' },
    {
      resource: 'Agent',
      id: agentId,
      to: '/agents',
      list: 'Agents',
      strict: true,
    },
  ].find(
    ({ id, strict }) =>
      id !== undefined && !(strict ? AGENT_ID_PATTERN : UUID_PATTERN).test(id),
  );
  if (invalidDetail) {
    const { resource, to, list } = invalidDetail;
    return (
      <NotFoundContent
        as="main"
        title={`This ${resource} link is invalid.`}
        to={to}
        linkLabel={`Back to ${list}`}
        mark="!"
      >
        {`Check the link, or return to ${list}.`}
      </NotFoundContent>
    );
  }
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
