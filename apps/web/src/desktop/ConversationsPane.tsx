import { useMemo, useState, useSyncExternalStore } from 'react';
import type {
  ChatCommands,
  Conversation,
  ConversationId,
} from '../components/chat/contracts';
import { ConversationsList } from '../components/chat/ConversationsList';
import type { AppStore } from '../stores/app';
import type { ConversationsStore } from '../stores/conversations';

export interface ConversationsPaneProps {
  readonly commands: ChatCommands;
  readonly appStore: AppStore;
  readonly conversationsStore: ConversationsStore;
  readonly onSelectConversation?: (conversationId: ConversationId) => void;
}

type ConversationFilter = 'all' | 'recent';

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
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ConversationFilter>('all');
  const selection = useSyncExternalStore(
    appStore.subscribe,
    appStore.getSnapshot,
  );
  const state = useSyncExternalStore(
    conversationsStore.subscribe,
    conversationsStore.getSnapshot,
  );
  const visibleConversations = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return [...state.conversations]
      .filter((conversation) =>
        query.length === 0
          ? true
          : (conversation.title ?? '').toLocaleLowerCase().includes(query),
      )
      .filter((conversation) =>
        filter === 'all' ? true : isRecentConversation(conversation),
      )
      .sort(compareUpdatedAt);
  }, [filter, search, state.conversations]);

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
    <aside className="sidebar" aria-label="Conversations navigation">
      <div className="pane-heading">
        <div>
          <span className="eyebrow">Workspace</span>
          <h1>Conversations</h1>
        </div>
        <span className="pane-count" aria-label={`${state.conversations.length} conversations`}>
          {state.conversations.length}
        </span>
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
                setAgentDefinitionId('');
                setCreateError(null);
              }}
            >
              Cancel
            </button>
          </div>
          {createError !== null ? <p role="alert">{createError}</p> : null}
        </form>
      ) : null}

      <div className="conversation-tools">
        <label className="sr-only" htmlFor="conversation-search">
          Search conversations
        </label>
        <input
          id="conversation-search"
          className="conversation-search"
          type="search"
          placeholder="Search conversations"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="conversation-filters" role="group" aria-label="Conversation filters">
          <button
            className="filter-chip"
            type="button"
            aria-pressed={filter === 'all'}
            data-active={filter === 'all' ? 'true' : 'false'}
            onClick={() => setFilter('all')}
          >
            All
          </button>
          <button
            className="filter-chip"
            type="button"
            aria-pressed={filter === 'recent'}
            data-active={filter === 'recent' ? 'true' : 'false'}
            onClick={() => setFilter('recent')}
          >
            Recent
          </button>
        </div>
      </div>

      <div className="sidebar-section">
        <ConversationsList
          state={state}
          visibleConversations={visibleConversations}
          selectedConversationId={selection.selectedConversationId}
          onSelect={select}
          onRetry={() => {
            void conversationsStore.load(commands.loadConversations);
          }}
        />
      </div>
    </aside>
  );
}

function isRecentConversation(conversation: Conversation): boolean {
  const updatedAt = Date.parse(conversation.updatedAt);
  return !Number.isNaN(updatedAt) && Date.now() - updatedAt <= 7 * 86_400_000;
}

function compareUpdatedAt(left: Conversation, right: Conversation): number {
  return (
    (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0) ||
    left.id.localeCompare(right.id)
  );
}

export default ConversationsPane;
