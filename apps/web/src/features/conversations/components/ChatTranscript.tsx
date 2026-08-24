import type { ReactNode } from 'react';
import type { ConversationId, ChatMessage } from './contracts';
import type { ConversationMessagesState } from '../stores/messages';
import { WorkCard } from '../../work/components/WorkCard';

export interface ChatTranscriptProps {
  readonly conversationId: ConversationId | null;
  readonly hasConversations: boolean;
  readonly state: ConversationMessagesState | null;
  readonly onRetry: () => void;
  readonly onOpenWork: (workId: string, conversationId: ConversationId) => void;
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

function Message({
  message,
  onOpenWork,
}: {
  readonly message: ChatMessage;
  readonly onOpenWork: (workId: string, conversationId: ConversationId) => void;
}) {
  return (
    <article className="chat-message" data-author-type={message.authorType}>
      <p>{message.body}</p>
      <WorkCard
        workRef={message.workRef}
        onOpen={(workId) => onOpenWork(workId, message.conversationId)}
      />
    </article>
  );
}

export function ChatTranscript({
  conversationId,
  hasConversations,
  state,
  onRetry,
  onOpenWork,
}: ChatTranscriptProps) {
  if (!hasConversations) {
    return <StateMessage>No conversations are available.</StateMessage>;
  }

  if (conversationId === null) {
    return (
      <StateMessage>Select a conversation to view its messages.</StateMessage>
    );
  }

  if (state === null || state.status === 'loading') {
    return <StateMessage>Loading messages…</StateMessage>;
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

  // A Coworker turn runs against a real provider and its execution budget is
  // minutes, not seconds. The transcript polls, so the reply does arrive, but
  // until it does the user was looking at their own message with no feedback.
  //
  // Deliberately worded as waiting, not as "the Agent is running": the message
  // projection carries no dispatch state, so the browser genuinely does not
  // know whether a Run is active, queued behind an earlier turn, or already
  // failed. Claiming otherwise would be the frontend inventing product state.
  const lastMessage = state.messages[state.messages.length - 1];
  const awaitingReply = lastMessage?.authorType === 'principal';

  return (
    <div
      className="chat-transcript"
      aria-live="polite"
      aria-label="Message transcript"
    >
      {state.messages.map((message) => (
        <Message
          key={`${message.sequence}:${message.id}`}
          message={message}
          onOpenWork={onOpenWork}
        />
      ))}
      {awaitingReply ? (
        <p className="chat-awaiting-reply" role="status">
          <span aria-hidden="true" className="chat-awaiting-dots">
            <span />
            <span />
            <span />
          </span>
          Waiting for a reply
        </p>
      ) : null}
    </div>
  );
}
