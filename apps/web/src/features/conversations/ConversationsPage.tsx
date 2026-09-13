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
import {
  conversationPath,
  isConversationsRootPath,
  workPath,
} from '../../app/routes';
import { NotFoundContent } from '../../app/router/NotFoundPage';
import { t as translateNow, useT, type Translate } from '../../i18n';

export interface ConversationsPageProps {
  readonly commands: ChatCommands;
  readonly appStore?: AppStore;
  readonly conversationsStore?: ConversationsStore;
  readonly messagesStore?: MessagesStore;
  readonly routeConversationId?: string | null;
  readonly returnConversationId?: string | null;
}

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
  const t = useT();
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
  const hasCompletedConversationList = useRef(false);
  if (conversationState.status === 'ready') {
    hasCompletedConversationList.current = true;
  }
  const routeConversationExists =
    routeConversationId !== null &&
    conversationState.conversations.some(
      ({ id }) => id === routeConversationId,
    );
  const conversationId = routeConversationId
    ? hasCompletedConversationList.current && routeConversationExists
      ? routeConversationId
      : null
    : selection.selectedConversationId;
  const messageState = conversationId
    ? (allMessageStates[conversationId] ??
      messageStore.getConversation(conversationId))
    : null;
  const messageNotFound = messageState?.status === 'not_found';
  const selectedConversation = conversationId
    ? conversationState.conversations.find(({ id }) => id === conversationId)
    : undefined;
  const routeConversationMissing =
    routeConversationId !== null &&
    hasCompletedConversationList.current &&
    !conversationState.conversations.some(
      ({ id }) => id === routeConversationId,
    );
  const selectedConversationMissing =
    routeConversationId !== null &&
    hasCompletedConversationList.current &&
    (messageNotFound ||
      (conversationState.status !== 'error' && routeConversationMissing));

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
    if (!selected && !isConversationsRootPath(location.pathname)) return;
    const selectedExists = selected
      ? conversations.some(({ id }) => id === selected)
      : false;
    const nextConversationId = selectedExists
      ? selected!
      : conversations[0]!.id;
    appSelectionStore.select(nextConversationId);
    initialSelectionResolved.current = true;
    if (isConversationsRootPath(location.pathname)) {
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
    if (!conversationId || messageNotFound) return;
    void messageStore.load(conversationId, commands.loadMessages);
  }, [commands.loadMessages, conversationId, messageNotFound, messageStore]);

  useEffect(() => {
    if (!conversationId || messageNotFound) return;

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
  }, [commands.loadMessages, conversationId, messageNotFound, messageStore]);

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
            translateNow('conversations.send.notPersisted'),
          );
          return;
        }
        if (message.conversationId !== conversationId) {
          messageStore.failSend(
            conversationId,
            body,
            translateNow('conversations.send.wrongConversation'),
          );
          return;
        }
        messageStore.append(conversationId, message);
        messageStore.completeSend(conversationId);
      } catch {
        messageStore.failSend(
          conversationId,
          body,
          translateNow('conversations.send.failed'),
        );
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

      <main className="chat-panel" data-typography-surface>
        <TitleBar section={t('conversations.title')} />
        <header className="chat-header">
          <div className="chat-header-title">
            <span className="conversation-header-avatar" aria-hidden="true">
              {selectedConversation
                ? conversationDisplayName(t, selectedConversation)
                    .slice(0, 1)
                    .toUpperCase() || 'C'
                : 'C'}
            </span>
            <div>
              <span className="eyebrow">
                {t('conversations.header.eyebrow')}
              </span>
              <h1>
                {selectedConversation
                  ? conversationDisplayName(t, selectedConversation)
                  : t('conversations.fallback.title')}
              </h1>
            </div>
          </div>
        </header>

        <section
          className="chat-content"
          aria-label={t('conversations.content.label')}
        >
          {(conversationState.status === 'idle' ||
            conversationState.status === 'loading') &&
          conversationState.conversations.length === 0 ? (
            <div className="empty-chat" role="status">
              <p>{t('conversations.list.loading')}</p>
            </div>
          ) : conversationState.status === 'error' &&
            (conversationState.conversations.length === 0 ||
              routeConversationId !== null) ? (
            <div className="empty-chat" role="alert">
              {routeConversationId !== null ? (
                <NotFoundContent
                  title={t('conversations.loadFailed.title')}
                  to="/"
                  linkLabel={t('conversations.unavailable.backLink')}
                  eyebrow={t('conversations.unavailable.eyebrow')}
                  retryLabel={t('common.tryAgain')}
                  onRetry={() =>
                    void conversationListStore.load(commands.loadConversations)
                  }
                  mark="!"
                >
                  {t('conversations.loadFailed.body')}
                </NotFoundContent>
              ) : (
                <>
                  <p>
                    {conversationState.error ??
                      t('conversations.list.loadError')}
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      void conversationListStore.load(
                        commands.loadConversations,
                      )
                    }
                  >
                    {t('common.retry')}
                  </button>
                </>
              )}
            </div>
          ) : selectedConversationMissing ? (
            <div data-testid="conversation-not-found">
              <NotFoundContent
                title={t('conversations.missing.title')}
                to="/"
                linkLabel={t('conversations.unavailable.backLink')}
                eyebrow={t('conversations.unavailable.eyebrow')}
              >
                {t('conversations.missing.body')}
              </NotFoundContent>
            </div>
          ) : (
            <>
              <ChatTranscript
                conversationId={conversationId}
                hasConversations={conversationState.conversations.length > 0}
                state={messageState}
                onRetry={retryMessages}
                onOpenWork={openWork}
                fallbackRecipientLabel={
                  selectedConversation?.directAgent?.displayName ?? null
                }
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

function conversationDisplayName(
  t: Translate,
  conversation: {
    readonly kind: 'direct' | 'group';
    readonly title: string | null;
    readonly directAgent: { readonly displayName: string | null } | null;
  },
): string {
  if (conversation.kind === 'direct') {
    return (
      conversation.directAgent?.displayName?.trim() ||
      t('conversations.fallback.agent')
    );
  }
  return conversation.title ?? t('conversations.fallback.title');
}

export default ConversationsPage;
