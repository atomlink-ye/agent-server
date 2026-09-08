import { useT, type Translate } from '../../../i18n';
import type { Conversation, ConversationId } from '../contracts';
import type { ConversationListState } from '../stores/conversations';

export interface ConversationsListProps {
  readonly state: ConversationListState;
  readonly visibleConversations?: readonly Conversation[];
  readonly selectedConversationId: ConversationId | null;
  readonly selectedConversationMissing?: boolean;
  readonly onSelect: (conversationId: ConversationId) => void;
  readonly onRetry: () => void;
}

export function ConversationsList({
  state,
  visibleConversations,
  selectedConversationId,
  selectedConversationMissing = false,
  onSelect,
  onRetry,
}: ConversationsListProps) {
  const t = useT();
  const conversations = visibleConversations ?? state.conversations;

  if (
    (state.status === 'idle' || state.status === 'loading') &&
    state.conversations.length === 0
  ) {
    return (
      <p className="conversation-placeholder">
        {t('conversations.list.loading')}
      </p>
    );
  }

  if (state.status === 'error' && state.conversations.length === 0) {
    return (
      <div className="conversation-placeholder" role="alert">
        <p>{state.error ?? t('conversations.list.loadError')}</p>
        <button type="button" onClick={onRetry}>
          {t('common.retry')}
        </button>
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <p className="conversation-placeholder">
        {selectedConversationMissing
          ? t('conversations.list.selectionUnavailable')
          : state.conversations.length === 0
            ? t('conversations.list.empty')
            : t('conversations.list.noMatches')}
      </p>
    );
  }

  return (
    <div
      className="conversation-list"
      aria-label={t('conversations.list.label')}
    >
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
            {conversationInitials(t, conversation)}
          </span>
          <span className="conversation-row-copy">
            <strong>{conversationDisplayName(t, conversation)}</strong>
            <time dateTime={conversation.updatedAt}>
              {formatUpdatedTime(conversation.updatedAt)}
            </time>
          </span>
        </button>
      ))}
      {state.status === 'error' ? (
        <div className="conversation-refresh-error" role="alert">
          <span>{state.error ?? t('conversations.list.refreshError')}</span>
          <button type="button" onClick={onRetry}>
            {t('common.retry')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function conversationInitials(
  t: Translate,
  conversation: Conversation,
): string {
  const source =
    conversationDisplayName(t, conversation).trim() || conversation.id;
  const words = source.split(/\s+/).filter(Boolean);
  return (
    words.length > 1
      ? `${words[0][0] ?? ''}${words[1][0] ?? ''}`
      : source.slice(0, 2)
  ).toUpperCase();
}

function conversationDisplayName(
  t: Translate,
  conversation: Conversation,
): string {
  if (conversation.kind === 'direct') {
    return (
      conversation.directAgent?.displayName?.trim() ||
      t('conversations.fallback.agent')
    );
  }
  return conversation.title ?? t('conversations.fallback.title');
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
