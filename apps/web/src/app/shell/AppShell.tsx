import { useLocation, useNavigate } from 'react-router-dom';

import type { ChatCommands } from '../../features/conversations/contracts';
import { ConversationsPage } from '../../features/conversations/ConversationsPage';
import AgentsPage from '../../features/agents/AgentsPage';
import FilesPage from '../../features/files/FilesPage';
import { WorkPage } from '../../features/work/WorkPage';
import type { AppStore } from '../../features/conversations/stores/app';
import type { ConversationsStore } from '../../features/conversations/stores/conversations';
import type { MessagesStore } from '../../features/conversations/stores/messages';
import { conversationPath, workPath, workRootPath } from '../routes';
import Rail, { type DesktopTab } from './Rail';

export interface AppShellProps {
  readonly commands: ChatCommands;
  readonly appStore?: AppStore;
  readonly conversationsStore?: ConversationsStore;
  readonly messagesStore?: MessagesStore;
  readonly routeConversationId?: string | null;
  readonly returnConversationId?: string | null;
  readonly selectedWorkId?: string | null;
  readonly workTab?: string | null;
  readonly selectedRunId?: string | null;
  readonly selectedSessionIndex?: number | null;
}

export function AppShell({
  commands,
  appStore,
  conversationsStore,
  messagesStore,
  routeConversationId = null,
  returnConversationId = null,
  selectedWorkId = null,
  workTab = null,
  selectedRunId = null,
  selectedSessionIndex = null,
}: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = tabForPath(location.pathname);

  const selectTab = (tab: DesktopTab): void => {
    if (tab === 'work') {
      const originConversationId = returnConversationId ?? routeConversationId;
      navigate(
        selectedWorkId
          ? workPath(selectedWorkId, originConversationId)
          : workRootPath(originConversationId),
      );
      return;
    }
    if (tab === 'agents') {
      navigate('/agents');
      return;
    }
    if (tab === 'files') {
      navigate('/files');
      return;
    }
    navigate(
      returnConversationId ? conversationPath(returnConversationId) : '/',
    );
  };

  return (
    <div className="app-shell">
      <Rail activeTab={activeTab} onSelectTab={selectTab} />
      {activeTab === 'conversations' ? (
        <ConversationsPage
          commands={commands}
          appStore={appStore}
          conversationsStore={conversationsStore}
          messagesStore={messagesStore}
          routeConversationId={routeConversationId}
          returnConversationId={returnConversationId}
        />
      ) : null}
      {activeTab === 'agents' ? <AgentsPage /> : null}
      {activeTab === 'files' ? <FilesPage /> : null}
      {activeTab === 'work' ? (
        <WorkPage
          returnConversationId={returnConversationId}
          selectedWorkId={selectedWorkId}
          workTab={workTab}
          selectedRunId={selectedRunId}
          selectedSessionIndex={selectedSessionIndex}
        />
      ) : null}
    </div>
  );
}

function tabForPath(pathname: string): DesktopTab {
  if (pathname.startsWith('/work')) return 'work';
  if (pathname.startsWith('/agents')) return 'agents';
  if (pathname.startsWith('/files')) return 'files';
  return 'conversations';
}

export default AppShell;
