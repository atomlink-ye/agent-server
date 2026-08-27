import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ChatCommands, Conversation, ConversationId } from './contracts';
import type { Coworker } from '../agents/contracts';
import { ConversationsList } from './components/ConversationsList';
import type { AppStore } from './stores/app';
import type { ConversationsStore } from './stores/conversations';

export interface ConversationsPaneProps {
  readonly commands: ChatCommands;
  readonly appStore: AppStore;
  readonly conversationsStore: ConversationsStore;
  readonly onSelectConversation?: (conversationId: ConversationId) => void;
  readonly selectedConversationMissing?: boolean;
}

type ConversationFilter = 'all' | 'recent';
type CoworkerLoadStatus = 'idle' | 'pending' | 'ready' | 'error';

export function ConversationsPane({
  commands,
  appStore,
  conversationsStore,
  onSelectConversation,
  selectedConversationMissing = false,
}: ConversationsPaneProps) {
  const [createOpen, setCreateOpen] = useState(false);
  // The picker's open/closed intent is read back by toggleCreate in the same
  // React batch that a close can be dispatched in, and batched state is not
  // visible to a handler that runs later in the same batch. Mirroring the
  // intent in a ref keeps "close then reopen" a real reopen instead of a
  // second close that silently skips the roster reload.
  const createOpenRef = useRef(false);
  const [coworkers, setCoworkers] = useState<readonly Coworker[]>([]);
  const [coworkerStatus, setCoworkerStatus] =
    useState<CoworkerLoadStatus>('idle');
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
          : conversationSearchLabel(conversation)
              .toLocaleLowerCase()
              .includes(query),
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

  const loadCoworkers = async (): Promise<void> => {
    if (coworkerStatus === 'pending') return;
    setCoworkerStatus('pending');
    setCreateError(null);
    try {
      const loaded = await commands.loadCoworkers();
      setCoworkers([...loaded].sort(compareCoworkers));
      setCoworkerStatus('ready');
    } catch (error) {
      setCoworkerStatus('error');
      setCreateError(error instanceof Error ? error.message : String(error));
    }
  };

  const create = async (agentDefinitionId: string): Promise<void> => {
    if (!agentDefinitionId || createStatus === 'pending') return;
    setCreateStatus('pending');
    setCreateError(null);
    try {
      const conversation = await commands.createConversation(agentDefinitionId);
      conversationsStore.hydrate([
        ...conversationsStore
          .getSnapshot()
          .conversations.filter(({ id }) => id !== conversation.id),
        conversation,
      ]);
      select(conversation.id);
      closeCreate();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreateStatus('idle');
    }
  };

  const openCoworker = (coworker: Coworker): void => {
    const existing = existingDirectConversation(
      conversationsStore.getSnapshot().conversations,
      coworker.id,
    );
    if (existing) {
      select(existing.id);
      closeCreate();
      return;
    }
    void create(coworker.id);
  };

  const closeCreate = (): void => {
    createOpenRef.current = false;
    setCreateOpen(false);
    setCreateError(null);
  };

  const toggleCreate = (): void => {
    const next = !createOpenRef.current;
    createOpenRef.current = next;
    setCreateOpen(next);
    setCreateError(null);
    if (next) void loadCoworkers();
  };

  return (
    <aside className="sidebar" aria-label="Conversations navigation">
      <div className="pane-heading">
        <div>
          <span className="eyebrow">Workspace</span>
          <h1>Conversations</h1>
        </div>
        <span
          className="pane-count"
          aria-label={`${state.conversations.length} conversations`}
        >
          {state.conversations.length}
        </span>
      </div>

      <button
        className="new-chat-button"
        type="button"
        disabled={createStatus === 'pending'}
        aria-expanded={createOpen}
        onClick={toggleCreate}
      >
        <span aria-hidden="true">+</span>
        New conversation
      </button>

      {createOpen ? (
        <div
          className="new-conversation-form"
          aria-busy={coworkerStatus === 'pending' || createStatus === 'pending'}
        >
          <span className="eyebrow">Choose a coworker</span>
          {coworkerStatus === 'pending' ? <p>Loading coworkers…</p> : null}
          {coworkerStatus === 'ready' && coworkers.length === 0 ? (
            <p>No published coworkers are available yet.</p>
          ) : null}
          {coworkerStatus === 'ready' ? (
            <div className="new-conversation-actions">
              {coworkers.map((coworker) => {
                const available = coworker.runtimeStatus === 'available';
                const secondary =
                  coworker.roleLabel ??
                  coworker.summary ??
                  coworker.runtimeStatus;
                const existing = existingDirectConversation(
                  state.conversations,
                  coworker.id,
                );
                return (
                  <button
                    key={coworker.id}
                    className="filter-chip"
                    type="button"
                    disabled={createStatus === 'pending' || !available}
                    title={coworker.summary ?? coworker.displayName}
                    onClick={() => openCoworker(coworker)}
                  >
                    {coworker.displayName}
                    {secondary ? ` · ${secondary}` : ''}
                    {existing ? ' · Open' : ''}
                    {!available ? ` · ${coworker.runtimeStatus}` : ''}
                  </button>
                );
              })}
            </div>
          ) : null}
          <div className="new-conversation-actions">
            {coworkerStatus === 'error' ? (
              <button
                type="button"
                disabled={createStatus === 'pending'}
                onClick={() => {
                  void loadCoworkers();
                }}
              >
                Retry
              </button>
            ) : null}
            <button
              type="button"
              disabled={createStatus === 'pending'}
              onClick={closeCreate}
            >
              Cancel
            </button>
          </div>
          {createError !== null ? <p role="alert">{createError}</p> : null}
        </div>
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
        <div
          className="conversation-filters"
          role="group"
          aria-label="Conversation filters"
        >
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
          selectedConversationMissing={selectedConversationMissing}
          onSelect={select}
          onRetry={() => {
            void conversationsStore.load(commands.loadConversations);
          }}
        />
      </div>
    </aside>
  );
}

function conversationSearchLabel(conversation: Conversation): string {
  if (conversation.kind === 'direct') {
    return conversation.directAgent?.displayName?.trim() || 'Agent';
  }
  return conversation.title?.trim() || 'Conversation';
}

function existingDirectConversation(
  conversations: readonly Conversation[],
  agentDefinitionId: string,
): Conversation | undefined {
  return conversations.find(
    (conversation) =>
      conversation.kind === 'direct' &&
      conversation.directAgent?.agentDefinitionId === agentDefinitionId,
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

function compareCoworkers(left: Coworker, right: Coworker): number {
  return (
    left.displayName.localeCompare(right.displayName) ||
    left.id.localeCompare(right.id)
  );
}

export default ConversationsPane;
