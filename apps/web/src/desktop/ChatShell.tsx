import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChatComposer } from '../components/chat/ChatComposer';
import { ChatTranscript } from '../components/chat/ChatTranscript';
import type { ChatCommands } from '../components/chat/contracts';
import { NewWork } from '../components/work/new-work';
import { WorkDetailShell } from '../components/work/work-shell';
import { AgentsSurface } from './AgentsSurface';
import { ConversationsPane } from './ConversationsPane';
import { FilesSurface } from './FilesSurface';
import Rail, { type DesktopTab } from './Rail';
import TitleBar from './TitleBar';
import { WorkPane } from './WorkPane';
import { createAppStore, type AppStore } from '../stores/app';
import {
  createConversationsStore,
  type ConversationsStore,
} from '../stores/conversations';
import { createMessagesStore, type MessagesStore } from '../stores/messages';
import '../work-integration.css';
import './workspace-surfaces.css';

export interface ChatShellProps {
  readonly commands: ChatCommands;
  readonly appStore?: AppStore;
  readonly conversationsStore?: ConversationsStore;
  readonly messagesStore?: MessagesStore;
  readonly routeConversationId?: string | null;
  readonly returnConversationId?: string | null;
  readonly selectedWorkId?: string | null;
  readonly workTab?: string | null;
  readonly selectedRunId?: string | null;
  readonly selectedSessionIndex?: string | null;
}

const sendFailureMessage = 'Unable to send this message. Please try again.';
const messageRefreshIntervalMs = 3000;
const conversationRefreshIntervalMs = 5000;

export function ChatShell({
  commands,
  appStore: providedAppStore,
  conversationsStore: providedConversationsStore,
  messagesStore: providedMessagesStore,
  routeConversationId = null,
  returnConversationId = null,
  selectedWorkId = null,
  workTab = null,
  selectedRunId = null,
  selectedSessionIndex = null,
}: ChatShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab: DesktopTab = location.pathname.startsWith('/work')
    ? 'work'
    : location.pathname.startsWith('/agents')
      ? 'agents'
      : location.pathname.startsWith('/files')
        ? 'files'
        : 'conversations';
  const [showNewWork, setShowNewWork] = useState(false);
  const appSelectionStore = useMemo(
    () => providedAppStore ?? createAppStore(),
    [providedAppStore],
  );
  const conversationListStore = useMemo(
    () =>
      providedConversationsStore ??
      createConversationsStore({ selectionStore: appSelectionStore }),
    [appSelectionStore, providedConversationsStore],
  );
  const messageStore = useMemo(
    () => providedMessagesStore ?? createMessagesStore(),
    [providedMessagesStore],
  );

  const selection = useSyncExternalStore(
    appSelectionStore.subscribe,
    appSelectionStore.getSnapshot,
  );
  const conversationState = useSyncExternalStore(
    conversationListStore.subscribe,
    conversationListStore.getSnapshot,
  );
  const allMessageStates = useSyncExternalStore(
    messageStore.subscribe,
    messageStore.getSnapshot,
  );
  const conversationId = selection.selectedConversationId;
  const messageState = conversationId
    ? (allMessageStates[conversationId] ??
      messageStore.getConversation(conversationId))
    : null;
  const selectedConversation = conversationId
    ? conversationState.conversations.find(({ id }) => id === conversationId)
    : undefined;

  useEffect(() => {
    void conversationListStore.load(commands.loadConversations);
  }, [commands.loadConversations, conversationListStore]);

  useEffect(() => {
    if (activeTab !== 'conversations') return;

    let disposed = false;
    let refreshInFlight = false;
    let intervalId: number | null = null;

    const stopPolling = (): void => {
      if (intervalId === null) return;
      window.clearInterval(intervalId);
      intervalId = null;
    };
    const refresh = (): void => {
      if (
        disposed ||
        refreshInFlight ||
        document.visibilityState !== 'visible'
      ) {
        return;
      }
      refreshInFlight = true;
      void conversationListStore.load(commands.loadConversations).finally(() => {
        refreshInFlight = false;
      });
    };
    const startPolling = (): void => {
      if (disposed || document.visibilityState !== 'visible') return;
      stopPolling();
      intervalId = window.setInterval(refresh, conversationRefreshIntervalMs);
    };
    const handleVisibilityChange = (): void => {
      stopPolling();
      if (document.visibilityState === 'visible') {
        refresh();
        startPolling();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    startPolling();
    return () => {
      disposed = true;
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [activeTab, commands.loadConversations, conversationListStore]);

  useEffect(() => {
    if (activeTab !== 'conversations' || conversationState.status !== 'ready')
      return;

    const conversations = conversationState.conversations;
    const routeExists = routeConversationId
      ? conversations.some(({ id }) => id === routeConversationId)
      : false;
    if (routeConversationId) {
      if (routeExists) appSelectionStore.select(routeConversationId);
      else appSelectionStore.clearSelection();
      return;
    }

    const returnedConversation = returnConversationId
      ? conversations.some(({ id }) => id === returnConversationId)
      : false;
    if (returnedConversation && returnConversationId) {
      appSelectionStore.select(returnConversationId);
      navigate(conversationPath(returnConversationId), { replace: true });
      return;
    }

    if (!conversations.length) {
      appSelectionStore.clearSelection();
      return;
    }

    const selected = appSelectionStore.getSnapshot().selectedConversationId;
    const selectedExists = selected
      ? conversations.some(({ id }) => id === selected)
      : false;
    const nextConversationId = selectedExists ? selected! : conversations[0]!.id;
    appSelectionStore.select(nextConversationId);
    if (location.pathname === '/') {
      navigate(conversationPath(nextConversationId), { replace: true });
    }
  }, [
    activeTab,
    appSelectionStore,
    conversationState.conversations,
    conversationState.status,
    location.pathname,
    navigate,
    returnConversationId,
    routeConversationId,
  ]);

  useEffect(() => {
    if (!conversationId) return;
    void messageStore.load(conversationId, commands.loadMessages);
  }, [commands.loadMessages, conversationId, messageStore]);

  useEffect(() => {
    if (selectedWorkId) setShowNewWork(false);
  }, [selectedWorkId]);

  useEffect(() => {
    if (activeTab !== 'conversations' || !conversationId) return;

    let disposed = false;
    let visibilityGeneration = 0;
    let refreshInFlight = false;
    let intervalId: number | null = null;

    const stopPolling = (): void => {
      if (intervalId === null) return;
      window.clearInterval(intervalId);
      intervalId = null;
    };

    const refresh = (): void => {
      if (
        disposed ||
        refreshInFlight ||
        document.visibilityState !== 'visible'
      ) {
        return;
      }
      const requestGeneration = visibilityGeneration;
      refreshInFlight = true;
      void messageStore
        .refresh(
          conversationId,
          commands.loadMessages,
          () =>
            !disposed &&
            requestGeneration === visibilityGeneration &&
            document.visibilityState === 'visible',
        )
        .then(
          () => {
            refreshInFlight = false;
          },
          () => {
            refreshInFlight = false;
          },
        );
    };

    const startPolling = (): void => {
      if (disposed || document.visibilityState !== 'visible') return;
      stopPolling();
      intervalId = window.setInterval(refresh, messageRefreshIntervalMs);
    };

    const handleVisibilityChange = (): void => {
      visibilityGeneration += 1;
      stopPolling();
      if (document.visibilityState === 'visible') {
        refresh();
        startPolling();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    startPolling();

    return () => {
      disposed = true;
      visibilityGeneration += 1;
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [activeTab, commands.loadMessages, conversationId, messageStore]);

  const send = useCallback(
    async (body: string): Promise<void> => {
      if (!conversationId || !messageStore.beginSend(conversationId, body)) return;
      try {
        const message = await commands.sendMessage(conversationId, body);
        if (!message) {
          messageStore.failSend(
            conversationId,
            body,
            'The message was not persisted. Please try again.',
          );
          return;
        }
        if (message.conversationId !== conversationId) {
          messageStore.failSend(
            conversationId,
            body,
            'The message was returned for a different conversation.',
          );
          return;
        }
        messageStore.append(conversationId, message);
        messageStore.completeSend(conversationId);
      } catch {
        messageStore.failSend(conversationId, body, sendFailureMessage);
      }
    },
    [commands.sendMessage, conversationId, messageStore],
  );

  const retrySend = useCallback((): void => {
    if (!conversationId || !messageState?.failedBody) return;
    void send(messageState.failedBody);
  }, [conversationId, messageState?.failedBody, send]);

  const retryMessages = useCallback((): void => {
    if (conversationId) {
      void messageStore.load(conversationId, commands.loadMessages);
    }
  }, [commands.loadMessages, conversationId, messageStore]);

  const setDraft = useCallback(
    (draft: string): void => {
      if (conversationId) messageStore.setDraft(conversationId, draft);
    },
    [conversationId, messageStore],
  );

  const openWork = useCallback(
    (workId: string, originatingConversationId: string): void => {
      setShowNewWork(false);
      navigate(workPath(workId, originatingConversationId));
    },
    [navigate],
  );

  const openWorkFromPane = useCallback(
    (workId: string): void => {
      setShowNewWork(false);
      navigate(workPath(workId, returnConversationId));
    },
    [navigate, returnConversationId],
  );

  const handleSelect = useCallback(
    (selectedConversationId: string): void => {
      appSelectionStore.select(selectedConversationId);
      navigate(conversationPath(selectedConversationId));
    },
    [appSelectionStore, navigate],
  );

  const handleSelectTab = useCallback(
    (tab: DesktopTab): void => {
      setShowNewWork(false);
      if (tab === 'work') {
        const origin =
          activeTab === 'conversations' ? conversationId : returnConversationId;
        navigate(
          selectedWorkId
            ? workPath(selectedWorkId, origin)
            : workRootPath(origin),
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
      const target = returnConversationId ?? conversationId;
      navigate(target ? conversationPath(target) : '/');
    },
    [
      activeTab,
      conversationId,
      navigate,
      returnConversationId,
      selectedWorkId,
    ],
  );

  const respondInChat = useCallback((): void => {
    navigate(
      returnConversationId ? conversationPath(returnConversationId) : '/',
    );
  }, [navigate, returnConversationId]);

  return (
    <div className="app-shell">
      <Rail activeTab={activeTab} onSelectTab={handleSelectTab} />

      {activeTab === 'agents' ? <AgentsSurface commands={commands} /> : null}
      {activeTab === 'files' ? <FilesSurface commands={commands} /> : null}

      {activeTab === 'conversations' ? (
        <>
          <ConversationsPane
            commands={commands}
            appStore={appSelectionStore}
            conversationsStore={conversationListStore}
            onSelectConversation={handleSelect}
          />

          <main className="chat-panel">
            <TitleBar section="Conversations" />
            <header className="chat-header">
              <div className="chat-header-title">
                <span className="conversation-header-avatar" aria-hidden="true">
                  {selectedConversation
                    ? conversationDisplayName(selectedConversation)
                        .slice(0, 1)
                        .toUpperCase() || 'C'
                    : 'C'}
                </span>
                <div>
                  <span className="eyebrow">Conversation</span>
                  <h1>
                    {selectedConversation
                      ? conversationDisplayName(selectedConversation)
                      : 'Conversation'}
                  </h1>
                </div>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="More options"
                disabled
              >
                ···
              </button>
            </header>

            <section className="chat-content" aria-label="Conversation">
              <ChatTranscript
                conversationId={conversationId}
                hasConversations={conversationState.conversations.length > 0}
                state={messageState}
                onRetry={retryMessages}
                onOpenWork={openWork}
              />
              <ChatComposer
                draft={messageState?.draft ?? ''}
                sending={messageState?.sendStatus === 'sending'}
                disabled={conversationId === null}
                sendError={messageState?.sendError ?? null}
                canRetry={messageState?.sendStatus === 'failed'}
                onDraftChange={setDraft}
                onSend={(body) => void send(body)}
                onRetry={retrySend}
              />
            </section>
          </main>
        </>
      ) : null}

      {activeTab === 'work' ? (
        <>
          <WorkPane
            commands={commands}
            onCreateNew={() => {
              navigate(workRootPath(returnConversationId));
              setShowNewWork(true);
            }}
            onOpenWork={openWorkFromPane}
            selectedWorkId={selectedWorkId}
          />
          <main className="chat-panel work-main">
            <TitleBar section="Work" />
            <section className="work-main-content" aria-label="Work overview">
              {returnConversationId && selectedWorkId ? (
                <div className="work-return-bar">
                  <button type="button" onClick={respondInChat}>
                    ← Respond in conversation
                  </button>
                </div>
              ) : null}
              {showNewWork ? <NewWork /> : null}
              {!showNewWork && selectedWorkId ? (
                <WorkDetailShell
                  workId={selectedWorkId}
                  tab={workTab ?? undefined}
                  selectedRunId={selectedRunId ?? undefined}
                  selectedSessionIndex={selectedSessionIndex ?? undefined}
                />
              ) : null}
              {!showNewWork && !selectedWorkId ? (
                <div className="work-main-empty">
                  <span className="work-main-icon" aria-hidden="true">
                    ✓
                  </span>
                  <h1>Choose a Work item</h1>
                  <p>Select a real Work item from the pane, or create a new Work.</p>
                  <button type="button" onClick={() => setShowNewWork(true)}>
                    New Work
                  </button>
                </div>
              ) : null}
            </section>
          </main>
        </>
      ) : null}
    </div>
  );
}

function conversationPath(conversationId: string): string {
  return `/conversations/${encodeURIComponent(conversationId)}`;
}

function workRootPath(originConversationId: string | null): string {
  return originConversationId
    ? `/work?from_conversation=${encodeURIComponent(originConversationId)}`
    : '/work';
}

function workPath(workId: string, originConversationId: string | null): string {
  const base = `/work/${encodeURIComponent(workId)}`;
  return originConversationId
    ? `${base}?from_conversation=${encodeURIComponent(originConversationId)}`
    : base;
}

function conversationDisplayName(conversation: {
  readonly kind: 'direct' | 'group';
  readonly title: string | null;
  readonly directAgent: { readonly displayName: string | null } | null;
}): string {
  if (conversation.kind === 'direct') {
    return conversation.directAgent?.displayName?.trim() || 'Agent';
  }
  return conversation.title ?? 'Conversation';
}

export default ChatShell;
