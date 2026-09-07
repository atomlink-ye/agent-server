import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type {
  ConversationId,
  ChatMessage,
  WorkItemDispatch,
} from '../contracts';
import type { ConversationMessagesState } from '../stores/messages';
import { WorkCard } from '../../work/components/WorkCard';
import { workOrganizationClient } from '../../work-organization/client';
import { isFeatureUnavailable } from '../../../api/feature-availability';
import { STATUS_LABELS } from '../../work-organization/format';
import { AssistantMarkdown } from './assistant-markdown';
import { recognizeLegacyWorkItemAssignmentBrief } from '../legacy-work-item-assignment-brief';
import './dispatch-card.css';

export interface ChatTranscriptProps {
  readonly conversationId: ConversationId | null;
  readonly hasConversations: boolean;
  readonly state: ConversationMessagesState | null;
  readonly onRetry: () => void;
  readonly onOpenWork: (workId: string, conversationId: ConversationId) => void;
  readonly fallbackRecipientLabel?: string | null;
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
  fallbackRecipientLabel,
}: {
  readonly message: ChatMessage;
  readonly showWorkCard: boolean;
  readonly onOpenWork: (workId: string, conversationId: ConversationId) => void;
  readonly fallbackRecipientLabel: string | null;
}) {
  const legacyDispatch =
    message.dispatch == null && message.authorType === 'principal'
      ? recognizeLegacyWorkItemAssignmentBrief(message.body)
      : null;
  const dispatch = message.dispatch ?? legacyDispatch;
  if (dispatch) {
    return (
      <DispatchCard
        dispatch={dispatch}
        body={message.body}
        fallbackRecipientLabel={fallbackRecipientLabel}
      />
    );
  }

  return (
    <NormalMessage
      message={message}
      showWorkCard={showWorkCard}
      onOpenWork={onOpenWork}
    />
  );
}

function NormalMessage({
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
          {taskError ? (
            <p className="chat-task-error" role="alert">
              {taskError}
            </p>
          ) : null}
          <div>
            <button type="button" onClick={() => setCreatingTask(false)}>
              Cancel
            </button>
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

type DispatchStatus =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly status: keyof typeof STATUS_LABELS }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'error' };

const dispatchRefreshIntervalMs = 3_000;

function DispatchCard({
  dispatch,
  body,
  fallbackRecipientLabel,
}: {
  readonly dispatch: WorkItemDispatch;
  readonly body: string;
  readonly fallbackRecipientLabel: string | null;
}) {
  const [status, setStatus] = useState<DispatchStatus>({ kind: 'loading' });
  const [taskTitle, setTaskTitle] = useState(dispatch.taskTitle);

  useEffect(() => {
    let disposed = false;
    let intervalId: number | null = null;
    let refreshInFlight = false;

    const load = (): void => {
      if (
        disposed ||
        refreshInFlight ||
        document.visibilityState !== 'visible'
      ) {
        return;
      }
      refreshInFlight = true;
      void workOrganizationClient
        .getWorkItem(dispatch.workItemId)
        .then((detail) => {
          if (disposed) return;
          const nextStatus = detail.work_item.status;
          setStatus({ kind: 'ready', status: nextStatus });
          setTaskTitle(detail.work_item.title);
        })
        .catch((reason: unknown) => {
          if (!disposed)
            setStatus({
              kind: isFeatureUnavailable(reason) ? 'unavailable' : 'error',
            });
        })
        .finally(() => {
          refreshInFlight = false;
        });
    };

    const startPolling = (): void => {
      if (disposed || document.visibilityState !== 'visible') return;
      load();
      intervalId = window.setInterval(load, dispatchRefreshIntervalMs);
    };
    const handleVisibility = (): void => {
      if (document.visibilityState === 'visible' && intervalId === null) {
        startPolling();
      } else if (
        document.visibilityState !== 'visible' &&
        intervalId !== null
      ) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    startPolling();
    return () => {
      disposed = true;
      if (intervalId !== null) window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [dispatch.workItemId]);

  const actor = safeLabel(dispatch.actorLabel, 'Someone');
  const recipient = safeLabel(
    dispatch.recipientLabel,
    safeLabel(fallbackRecipientLabel, 'Coworker'),
  );
  const action =
    dispatch.reason === 'assignment'
      ? 'assigned'
      : dispatch.reason === 'mention'
        ? 'mentioned'
        : 'commented for';

  return (
    <article className="dispatch-card" aria-label="Task dispatch">
      <p className="dispatch-card__event">
        <strong>{actor}</strong> {action} <strong>{recipient}</strong>{' '}
        {dispatch.reason === 'assignment' ? 'to' : 'on'}{' '}
        <Link to={`/tasks/${encodeURIComponent(dispatch.workItemId)}`}>
          {taskTitle}
        </Link>
      </p>
      <p className="dispatch-card__status" aria-live="polite">
        {status.kind === 'loading' ? 'Checking task status…' : null}
        {status.kind === 'ready' ? STATUS_LABELS[status.status] : null}
        {status.kind === 'unavailable' ? 'Task status is unavailable.' : null}
        {status.kind === 'error' ? 'Task status could not be loaded.' : null}
      </p>
      <details className="dispatch-card__details">
        <summary>Dispatch details</summary>
        <p>{body}</p>
      </details>
    </article>
  );
}

function safeLabel(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && !isUuidLike(trimmed) ? trimmed : fallback;
}

function isUuidLike(value: string): boolean {
  return /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu.test(
    value,
  );
}

export function ChatTranscript({
  conversationId,
  hasConversations,
  state,
  onRetry,
  onOpenWork,
  fallbackRecipientLabel = null,
}: ChatTranscriptProps) {
  const navigate = useNavigate();

  if (!hasConversations) {
    return (
      <div className="empty-chat conversation-empty-state" role="status">
        <div className="empty-chat-icon" aria-hidden="true">
          <span>✦</span>
        </div>
        <h1>Ready when you are</h1>
        <p>
          Start with a Coworker, then this is where your shared context and
          replies will live.
        </p>
        <button type="button" onClick={() => navigate('/agents')}>
          Meet your Coworkers
        </button>
      </div>
    );
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
          fallbackRecipientLabel={fallbackRecipientLabel}
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
