import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChatComposer } from './components/ChatComposer';
import { ChatTranscript } from './components/ChatTranscript';
import type { ChatCommands } from './contracts';
import { ConversationsPane } from './ConversationsPane';
import TitleBar from '../../app/shell/TitleBar';
import { createAppStore, type AppStore } from './stores/app';
import {
  createConversationsStore,
  type ConversationsStore,
} from './stores/conversations';
import { createMessagesStore, type MessagesStore } from './stores/messages';
import { conversationPath, workPath } from '../../app/routes';

export interface ConversationsPageProps {
  readonly commands: ChatCommands;
  readonly appStore?: AppStore;
  readonly conversationsStore?: ConversationsStore;
  readonly messagesStore?: MessagesStore;
  readonly routeConversationId?: string | null;
  readonly returnConversationId?: string | null;
}

const sendFailureMessage = 'Unable to send this message. Please try again.';
const messageRefreshIntervalMs = 3000;
const conversationRefreshIntervalMs = 5000;

export function ConversationsPage({
  commands,
  appStore: providedAppStore,
  conversationsStore: providedConversationsStore,
  messagesStore: providedMessagesStore,
  routeConversationId = null,
  returnConversationId = null,
}: ConversationsPageProps) {
  const location = useLocation();
  const navigate = useNavigate();
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
  const initialSelectionResolved = useRef(false);

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
  const selectedConversationMissing =
    (routeConversationId !== null &&
      conversationState.status === 'ready' &&
      selectedConversation === undefined) ||
    messageState?.status === 'not_found';

  useEffect(() => {
    void conversationListStore.load(commands.loadConversations);
  }, [commands.loadConversations, conversationListStore]);

  useEffect(() => {
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
      void conversationListStore
        .load(commands.loadConversations)
        .finally(() => {
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
  }, [commands.loadConversations, conversationListStore]);

  useEffect(() => {
    if (conversationState.status !== 'ready') return;

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
    if (!selected && initialSelectionResolved.current) return;
    if (!selected && location.pathname !== '/') return;
    const selectedExists = selected
      ? conversations.some(({ id }) => id === selected)
      : false;
    const nextConversationId = selectedExists
      ? selected!
      : conversations[0]!.id;
    appSelectionStore.select(nextConversationId);
    initialSelectionResolved.current = true;
    if (location.pathname === '/') {
      navigate(conversationPath(nextConversationId), { replace: true });
    }
  }, [
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
    if (!conversationId) return;

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
  }, [commands.loadMessages, conversationId, messageStore]);

  const send = useCallback(
    async (body: string): Promise<void> => {
      if (!conversationId || !messageStore.beginSend(conversationId, body))
        return;
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
      navigate(workPath(workId, originatingConversationId));
    },
    [navigate],
  );

  const handleSelect = useCallback(
    (selectedConversationId: string): void => {
      appSelectionStore.select(selectedConversationId);
      navigate(conversationPath(selectedConversationId));
    },
    [appSelectionStore, navigate],
  );

  return (
    <>
      <ConversationsPane
        commands={commands}
        appStore={appSelectionStore}
        conversationsStore={conversationListStore}
        onSelectConversation={handleSelect}
        selectedConversationMissing={selectedConversationMissing}
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
          <div className="disabled-conversation-action">
            <button
              className="icon-button"
              type="button"
              aria-label="More options"
              aria-describedby="conversation-options-reason"
              disabled
            >
              ···
            </button>
            <span id="conversation-options-reason" role="tooltip">
              More conversation options aren’t available yet.
            </span>
          </div>
        </header>

        <section className="chat-content" aria-label="Conversation">
          {selectedConversationMissing ? (
            <div className="empty-chat" data-testid="conversation-not-found">
              <div className="empty-chat-icon" aria-hidden="true">
                <span>✦</span>
              </div>
              <h1>The selected Conversation is unavailable.</h1>
              <p>
                This Conversation may have been deleted or moved out of this
                workspace.
              </p>
              <button type="button" onClick={() => navigate('/')}>
                Back to Conversations
              </button>
            </div>
          ) : (
            <>
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
            </>
          )}
        </section>
      </main>
    </>
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

export default ConversationsPage;
