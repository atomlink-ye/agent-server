import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ConversationId, ChatMessage } from './contracts';
import type { ConversationMessagesState } from '../stores/messages';
import { WorkCard } from '../../work/components/WorkCard';
import { workOrganizationClient } from '../../work-organization/client';
import { AssistantMarkdown } from './assistant-markdown';

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
  showWorkCard,
  onOpenWork,
}: {
  readonly message: ChatMessage;
  readonly showWorkCard: boolean;
  readonly onOpenWork: (workId: string, conversationId: ConversationId) => void;
}) {
  const navigate = useNavigate();
  const [creatingTask, setCreatingTask] = useState(false);
  const [taskTitle, setTaskTitle] = useState(message.body.slice(0, 120));
  const [taskDescription, setTaskDescription] = useState(message.body);
  const [savingTask, setSavingTask] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);

  async function createTask(): Promise<void> {
    if (!taskTitle.trim() || savingTask) return;
    setSavingTask(true);
    setTaskError(null);
    try {
      const detail = await workOrganizationClient.createWorkItem({
        title: taskTitle.trim(),
        description: taskDescription.trim() || null,
        sourceConversationId: message.conversationId,
        sourceMessageId: message.id,
      });
      navigate(`/tasks/${encodeURIComponent(detail.work_item.id)}`);
    } catch (reason) {
      setTaskError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSavingTask(false);
    }
  }

  return (
    <>
      <div className="chat-message-with-actions">
        <article className="chat-message" data-author-type={message.authorType}>
          {message.authorType === 'principal' ? (
            <p>{message.body}</p>
          ) : (
            <AssistantMarkdown text={message.body} />
          )}
        </article>
        <button
          type="button"
          className="chat-message-task-action"
          aria-label="Create Task from this message"
          onClick={() => setCreatingTask((value) => !value)}
        >
          ☑ Create task
        </button>
      </div>
      {creatingTask ? (
        <form
          className="chat-task-form"
          onSubmit={(event) => {
            event.preventDefault();
            void createTask();
          }}
        >
          <strong>Create Task from message</strong>
          <label>
            Title
            <input
              autoFocus
              value={taskTitle}
              maxLength={200}
              onChange={(event) => setTaskTitle(event.target.value)}
            />
          </label>
          <label>
            Description
            <textarea
              rows={3}
              value={taskDescription}
              onChange={(event) => setTaskDescription(event.target.value)}
            />
          </label>
          {taskError ? <p className="chat-task-error" role="alert">{taskError}</p> : null}
          <div>
            <button type="button" onClick={() => setCreatingTask(false)}>Cancel</button>
            <button type="submit" disabled={savingTask || !taskTitle.trim()}>
              {savingTask ? 'Creating…' : 'Create Task'}
            </button>
          </div>
        </form>
      ) : null}
      {showWorkCard ? (
        <WorkCard
          workRef={message.workRef}
          onOpen={(workId) => onOpenWork(workId, message.conversationId)}
        />
      ) : null}
    </>
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

  const lastMessage = state.messages[state.messages.length - 1];
  const awaitingReply = lastMessage?.authorType === 'principal';
  const cardAnchorByWork = new Map<string, number>();
  for (const message of state.messages) {
    if (message.workRef && !cardAnchorByWork.has(message.workRef))
      cardAnchorByWork.set(message.workRef, message.sequence);
  }

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
          showWorkCard={
            message.workRef !== null &&
            cardAnchorByWork.get(message.workRef) === message.sequence
          }
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
