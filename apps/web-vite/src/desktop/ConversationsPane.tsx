import { useState } from 'react';
import type {
  ChatCommands,
  ConversationId,
} from '../components/chat/contracts';
import { ConversationsList } from '../components/chat/ConversationsList';
import type { AppStore } from '../stores/app';
import type { ConversationsStore } from '../stores/conversations';
import { useSyncExternalStore } from 'react';

export interface ConversationsPaneProps {
  readonly commands: ChatCommands;
  readonly appStore: AppStore;
  readonly conversationsStore: ConversationsStore;
  readonly onSelectConversation?: (conversationId: ConversationId) => void;
}

export function ConversationsPane({
  commands,
  appStore,
  conversationsStore,
  onSelectConversation,
}: ConversationsPaneProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [agentDefinitionId, setAgentDefinitionId] = useState('');
  const [createStatus, setCreateStatus] = useState<'idle' | 'pending'>('idle');
  const [createError, setCreateError] = useState<string | null>(null);
  const selection = useSyncExternalStore(
    appStore.subscribe,
    appStore.getSnapshot,
  );
  const state = useSyncExternalStore(
    conversationsStore.subscribe,
    conversationsStore.getSnapshot,
  );
  const select = (conversationId: ConversationId): void => {
    appStore.select(conversationId);
    onSelectConversation?.(conversationId);
  };

  const create = async (): Promise<void> => {
    const trimmedAgentDefinitionId = agentDefinitionId.trim();
    if (!trimmedAgentDefinitionId || createStatus === 'pending') return;
    setCreateStatus('pending');
    setCreateError(null);
    try {
      const conversation = await commands.createConversation(
        trimmedAgentDefinitionId,
      );
      conversationsStore.hydrate([
        ...conversationsStore
          .getSnapshot()
          .conversations.filter(({ id }) => id !== conversation.id),
        conversation,
      ]);
      select(conversation.id);
      setAgentDefinitionId('');
      setCreateOpen(false);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreateStatus('idle');
    }
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
        disabled={createStatus === 'pending'}
        aria-expanded={createOpen}
        onClick={() => {
          setCreateOpen((open) => !open);
          setCreateError(null);
        }}
      >
        <span aria-hidden="true">+</span>
        New conversation
      </button>

      {createOpen ? (
        <form
          className="new-conversation-form"
          aria-busy={createStatus === 'pending'}
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <label htmlFor="new-conversation-agent-definition">
            Agent definition ID
          </label>
          <input
            id="new-conversation-agent-definition"
            value={agentDefinitionId}
            disabled={createStatus === 'pending'}
            onChange={(event) => setAgentDefinitionId(event.target.value)}
          />
          <div className="new-conversation-actions">
            <button
              type="submit"
              disabled={
                createStatus === 'pending' ||
                agentDefinitionId.trim().length === 0
              }
            >
              {createStatus === 'pending' ? 'Creating…' : 'Create'}
            </button>
            <button
              type="button"
              disabled={createStatus === 'pending'}
              onClick={() => {
                setCreateOpen(false);
                setCreateError(null);
              }}
            >
              Cancel
            </button>
          </div>
          {createError !== null ? <p role="alert">{createError}</p> : null}
        </form>
      ) : null}

      <div className="sidebar-section">
        <span className="sidebar-label">Conversations</span>
        <ConversationsList
          state={state}
          selectedConversationId={selection.selectedConversationId}
          onSelect={select}
          onRetry={() => {
            void conversationsStore.load(commands.loadConversations);
          }}
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
