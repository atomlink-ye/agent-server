import type { ConversationId } from './contracts';
import type { ConversationListState } from '../../stores/conversations';

export interface ConversationsListProps {
  readonly state: ConversationListState;
  readonly selectedConversationId: ConversationId | null;
  readonly onSelect: (conversationId: ConversationId) => void;
  readonly onRetry: () => void;
  readonly connected: boolean;
}

export function ConversationsList({
  state,
  selectedConversationId,
  onSelect,
  onRetry,
  connected,
}: ConversationsListProps) {
  if (state.status === 'loading' && state.conversations.length === 0) {
    return <p className="conversation-placeholder">Loading conversations…</p>;
  }

  if (state.status === 'error' && state.conversations.length === 0) {
    return (
      <div className="conversation-placeholder" role="alert">
        <span>
          {state.error ?? 'Unable to load conversations.'}
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </span>
      </div>
    );
  }

  if (state.conversations.length === 0) {
    return (
      <p className="conversation-placeholder">
        <span className="placeholder-dot" aria-hidden="true" />
        {connected ? 'No conversations yet.' : 'Conversations are not connected yet.'}
      </p>
    );
  }

  return (
    <div aria-label="Conversations">
      {state.conversations.map((conversation) => (
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
          <span>{conversation.title ?? 'Untitled conversation'}</span>
        </button>
      ))}
      {state.status === 'error' ? (
        <div role="alert">
          <span>{state.error ?? 'Unable to refresh conversations.'}</span>
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}
