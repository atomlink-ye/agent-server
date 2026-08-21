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
import { ConversationsPane } from './ConversationsPane';
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

export interface ChatShellProps {
  readonly commands: ChatCommands;
  readonly appStore?: AppStore;
  readonly conversationsStore?: ConversationsStore;
  readonly messagesStore?: MessagesStore;
  readonly returnConversationId?: string | null;
  readonly selectedWorkId?: string | null;
  readonly workTab?: string | null;
  readonly selectedRunId?: string | null;
  readonly selectedSessionIndex?: string | null;
}

const sendFailureMessage = 'Unable to send this message. Please try again.';
const messageRefreshIntervalMs = 3000;

export function ChatShell({
  commands,
  appStore: providedAppStore,
  conversationsStore: providedConversationsStore,
  messagesStore: providedMessagesStore,
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
    ? (allMessageStates[conversationId] ?? messageStore.getConversation(conversationId))
    : null;
  const selectedConversation = conversationId
    ? conversationState.conversations.find(({ id }) => id === conversationId)
    : undefined;

  useEffect(() => {
    void conversationListStore.load(commands.loadConversations);
  }, [commands.loadConversations, conversationListStore]);

  useEffect(() => {
    if (conversationState.status !== 'ready') return;
    const returnedConversation = returnConversationId
      ? conversationState.conversations.some(({ id }) => id === returnConversationId)
      : false;
    const selected = appSelectionStore.getSnapshot().selectedConversationId;
    if (returnedConversation) {
      appSelectionStore.select(returnConversationId);
    } else if (returnConversationId || !conversationState.conversations.length) {
      appSelectionStore.clearSelection();
    } else if (
      selected === null ||
      !conversationState.conversations.some(({ id }) => id === selected)
    ) {
      appSelectionStore.select(conversationState.conversations[0].id);
    }
  }, [
    appSelectionStore,
    conversationState.conversations,
    conversationState.status,
    returnConversationId,
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
      if (document.visibilityState === 'visible') startPolling();
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
      navigate(`/work/${encodeURIComponent(workId)}`, {
        state: { returnConversationId: originatingConversationId },
      });
    },
    [navigate],
  );

  const openWorkFromPane = useCallback(
    (workId: string): void => {
      setShowNewWork(false);
      navigate(`/work/${encodeURIComponent(workId)}`);
    },
    [navigate],
  );

  const handleSelect = useCallback(
    (selectedConversationId: string): void => {
      appSelectionStore.select(selectedConversationId);
    },
    [appSelectionStore],
  );

  const handleSelectTab = useCallback(
    (tab: DesktopTab): void => {
      setShowNewWork(false);
      if (tab === 'work') {
        navigate(selectedWorkId ? `/work/${encodeURIComponent(selectedWorkId)}` : '/work');
        return;
      }
      navigate('/', {
        state: returnConversationId ? { returnConversationId } : undefined,
      });
    },
    [navigate, returnConversationId, selectedWorkId],
  );

  const respondInChat = useCallback((): void => {
    navigate('/', {
      state: returnConversationId ? { returnConversationId } : undefined,
    });
  }, [navigate, returnConversationId]);

  return (
    <div className="app-shell">
      <Rail activeTab={activeTab} onSelectTab={handleSelectTab} />

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
      ) : (
        <>
          <WorkPane
            commands={commands}
            onCreateNew={() => {
              navigate('/work');
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
      )}
    </div>
  );
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
