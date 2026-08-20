import { useState } from 'react';
import type { ChatCommands, Conversation, ConversationId } from '../components/chat/contracts';
import { ConversationsList } from '../components/chat/ConversationsList';
import type { AppStore } from '../stores/app';
import type { ConversationsStore } from '../stores/conversations';
import { useSyncExternalStore } from 'react';

export interface ConversationsPaneProps {
  readonly commands?: ChatCommands;
  readonly appStore: AppStore;
  readonly conversationsStore: ConversationsStore;
  readonly onNewConversation?: (conversation: Conversation) => void;
  readonly onSelectConversation?: (conversationId: ConversationId) => void;
}

export function ConversationsPane({
  commands,
  appStore,
  conversationsStore,
  onNewConversation,
  onSelectConversation,
}: ConversationsPaneProps) {
  const [creating, setCreating] = useState(false);
  const selection = useSyncExternalStore(appStore.subscribe, appStore.getSnapshot);
  const state = useSyncExternalStore(
    conversationsStore.subscribe,
    conversationsStore.getSnapshot,
  );
  const canCreate = commands?.createConversation !== undefined;

  const createConversation = async (): Promise<void> => {
    if (!commands?.createConversation || creating) return;
    setCreating(true);
    try {
      const conversation = await commands.createConversation();
      conversationsStore.hydrate([
        ...conversationsStore.getSnapshot().conversations,
        conversation,
      ]);
      appStore.select(conversation.id);
      onNewConversation?.(conversation);
    } finally {
      setCreating(false);
    }
  };

  const select = (conversationId: ConversationId): void => {
    appStore.select(conversationId);
    onSelectConversation?.(conversationId);
  };

  return (
    <aside className="sidebar" aria-label="Chat navigation">
      <div className="wordmark">
        <span className="wordmark-mark" aria-hidden="true">
          ✦
        </span>
        <span>Chat</span>
      </div>

      <button
        className="new-chat-button"
        type="button"
        disabled={!canCreate || creating}
        onClick={() => void createConversation()}
      >
        <span aria-hidden="true">＋</span>
        New conversation
      </button>

      <div className="sidebar-section">
        <span className="sidebar-label">Conversations</span>
        <ConversationsList
          state={state}
          selectedConversationId={selection.selectedConversationId}
          onSelect={select}
          onRetry={() => {
            if (commands?.loadConversations) {
              void conversationsStore.load(commands.loadConversations);
            }
          }}
          connected={commands?.loadConversations !== undefined}
        />
      </div>

      <div className="sidebar-footer">
        <div className="profile-avatar" aria-hidden="true">
          ✦
        </div>
        <div>
          <strong>Workspace</strong>
          <span>Chat</span>
        </div>
      </div>
    </aside>
  );
}

export default ConversationsPane;
