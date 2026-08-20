import {
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { ChatComposer } from '../components/chat/ChatComposer';
import { ChatTranscript } from '../components/chat/ChatTranscript';
import type { ChatCommands } from '../components/chat/contracts';
import { ConversationsPane } from './ConversationsPane';
import { createAppStore, type AppStore } from '../stores/app';
import {
  createConversationsStore,
  type ConversationsStore,
} from '../stores/conversations';
import { createMessagesStore, type MessagesStore } from '../stores/messages';

export interface ChatShellProps {
  readonly commands: ChatCommands;
  readonly appStore?: AppStore;
  readonly conversationsStore?: ConversationsStore;
  readonly messagesStore?: MessagesStore;
  readonly returnConversationId?: string | null;
}

const sendFailureMessage = 'Unable to send this message. Please try again.';

export function ChatShell({
  commands,
  appStore: providedAppStore,
  conversationsStore: providedConversationsStore,
  messagesStore: providedMessagesStore,
  returnConversationId = null,
}: ChatShellProps) {
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
    (workId: string, returnConversationId: string): void => {
      navigate(`/work/${encodeURIComponent(workId)}`, {
        state: { returnConversationId },
      });
    },
    [navigate],
  );

  const handleSelect = useCallback(
    (selectedConversationId: string): void => {
      appSelectionStore.select(selectedConversationId);
    },
    [appSelectionStore],
  );

  return (
    <div className="app-shell">
      <ConversationsPane
        commands={commands}
        appStore={appSelectionStore}
        conversationsStore={conversationListStore}
        onSelectConversation={handleSelect}
      />

      <main className="chat-panel">
        <header className="chat-header">
          <div>
            <span className="eyebrow">Workspace</span>
            <h1>{selectedConversation?.title ?? 'Untitled conversation'}</h1>
          </div>
          <button className="icon-button" type="button" aria-label="More options" disabled>
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
    </div>
  );
}

export default ChatShell;
