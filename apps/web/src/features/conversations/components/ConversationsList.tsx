import type { Conversation, ConversationId } from './contracts';
import type { ConversationListState } from '../stores/conversations';

export interface ConversationsListProps {
  readonly state: ConversationListState;
  readonly visibleConversations?: readonly Conversation[];
  readonly selectedConversationId: ConversationId | null;
  readonly onSelect: (conversationId: ConversationId) => void;
  readonly onRetry: () => void;
}

export function ConversationsList({
  state,
  visibleConversations,
  selectedConversationId,
  onSelect,
  onRetry,
}: ConversationsListProps) {
  const conversations = visibleConversations ?? state.conversations;

  if (state.status === 'loading' && state.conversations.length === 0) {
    return <p className="conversation-placeholder">Loading conversations…</p>;
  }

  if (state.status === 'error' && state.conversations.length === 0) {
    return (
      <div className="conversation-placeholder" role="alert">
        <p>{state.error ?? 'Unable to load conversations.'}</p>
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <p className="conversation-placeholder">
        {state.conversations.length === 0
          ? 'No conversations yet.'
          : 'No matching conversations.'}
      </p>
    );
  }

  return (
    <div className="conversation-list" aria-label="Conversations">
      {conversations.map((conversation) => (
        <button
          key={conversation.id}
          data-conversation-id={conversation.id}
          className="conversation-item"
          type="button"
          aria-current={
            selectedConversationId === conversation.id ? 'page' : undefined
          }
          onClick={() => onSelect(conversation.id)}
        >
          <span
            className={`conversation-avatar conversation-avatar--${avatarTone(conversation)}`}
            aria-hidden="true"
          >
            {conversationInitials(conversation)}
          </span>
          <span className="conversation-row-copy">
            <strong>{conversationDisplayName(conversation)}</strong>
            <time dateTime={conversation.updatedAt}>
              {formatUpdatedTime(conversation.updatedAt)}
            </time>
          </span>
        </button>
      ))}
      {state.status === 'error' ? (
        <div className="conversation-refresh-error" role="alert">
          <span>{state.error ?? 'Unable to refresh conversations.'}</span>
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}

function conversationInitials(conversation: Conversation): string {
  const source =
    conversationDisplayName(conversation).trim() || conversation.id;
  const words = source.split(/\s+/).filter(Boolean);
  return (
    words.length > 1
      ? `${words[0][0] ?? ''}${words[1][0] ?? ''}`
      : source.slice(0, 2)
  ).toUpperCase();
}

function conversationDisplayName(conversation: Conversation): string {
  if (conversation.kind === 'direct') {
    return conversation.directAgent?.displayName?.trim() || 'Agent';
  }
  return conversation.title ?? 'Conversation';
}

function avatarTone(conversation: Conversation): number {
  const source = `${conversation.title ?? ''}:${conversation.id}`;
  return (
    [...source].reduce((hash, character) => hash + character.charCodeAt(0), 0) %
    5
  );
}

function formatUpdatedTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
