import type { ReactNode } from 'react';
import type { ConversationId, ChatMessage } from './contracts';
import type { ConversationMessagesState } from '../../stores/messages';

export interface ChatTranscriptProps {
  readonly conversationId: ConversationId | null;
  readonly hasConversations: boolean;
  readonly connected: boolean;
  readonly state: ConversationMessagesState | null;
  readonly onRetry: () => void;
}

function StateMessage({ children }: { readonly children: ReactNode }) {
  return (
    <div className="empty-chat" role="status">
      <div className="empty-chat-icon" aria-hidden="true">
        <span>✦</span>
      </div>
      <p>{children}</p>
    </div>
  );
}

function Message({ message }: { readonly message: ChatMessage }) {
  return (
    <article className="chat-message" data-author-type={message.authorType}>
      <p>{message.body}</p>
    </article>
  );
}

export function ChatTranscript({
  conversationId,
  hasConversations,
  connected,
  state,
  onRetry,
}: ChatTranscriptProps) {
  if (!hasConversations) {
    return <StateMessage>No conversations are available.</StateMessage>;
  }

  if (conversationId === null) {
    return <StateMessage>Select a conversation to view its messages.</StateMessage>;
  }

  if (state === null || state.status === 'loading') {
    return <StateMessage>Loading messages…</StateMessage>;
  }

  if (state.status === 'idle' && !connected) {
    return <StateMessage>Messages are not connected yet.</StateMessage>;
  }

  if (state.status === 'error') {
    return (
      <div className="empty-chat" role="alert">
        <p>{state.error ?? 'Unable to load messages.'}</p>
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }

  if (state.messages.length === 0) {
    return <StateMessage>No messages in this conversation yet.</StateMessage>;
  }

  return (
    <div className="chat-transcript" aria-live="polite" aria-label="Message transcript">
      {state.messages.map((message) => (
        <Message key={`${message.sequence}:${message.id}`} message={message} />
      ))}
    </div>
  );
}
