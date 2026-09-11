import { useEffect, useState, type ReactNode } from 'react';
import type { WorkItemStatus } from '@atomlink-ye/agent-server/product-contract';
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
import { statusLabel } from '../../work-organization/format';
import { useT } from '../../../i18n';
import { useRichT } from '../../../i18n/rich';
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
  const t = useT();
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
    } catch {
      setTaskError(t('tasks.actionError'));
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
          aria-label={t('transcript.task.actionLabel')}
          onClick={() => setCreatingTask((value) => !value)}
        >
          ☑ {t('transcript.task.action')}
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
          <strong>{t('transcript.task.formTitle')}</strong>
          <label>
            {t('transcript.task.title')}
            <input
              autoFocus
              value={taskTitle}
              maxLength={200}
              onChange={(event) => setTaskTitle(event.target.value)}
            />
          </label>
          <label>
            {t('transcript.task.description')}
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
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={savingTask || !taskTitle.trim()}>
              {savingTask
                ? t('transcript.task.submitting')
                : t('transcript.task.submit')}
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
  | { readonly kind: 'ready'; readonly status: WorkItemStatus }
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
  const t = useT();
  const richT = useRichT();
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

  const actor = safeLabel(dispatch.actorLabel, t('dispatch.actor.fallback'));
  const recipient = safeLabel(
    dispatch.recipientLabel,
    safeLabel(fallbackRecipientLabel, t('dispatch.recipient.fallback')),
  );
  // The event is one whole sentence, not fragments joined in JSX: Chinese puts
  // the task before the recipient, and only a full template can move them.
  const eventKey =
    dispatch.reason === 'assignment'
      ? 'dispatch.event.assignment'
      : dispatch.reason === 'mention'
        ? 'dispatch.event.mention'
        : 'dispatch.event.comment';

  return (
    <article className="dispatch-card" aria-label={t('dispatch.label')}>
      <p className="dispatch-card__event">
        {richT(eventKey, {
          actor: <strong>{actor}</strong>,
          recipient: <strong>{recipient}</strong>,
          task: (
            <Link to={`/tasks/${encodeURIComponent(dispatch.workItemId)}`}>
              {taskTitle}
            </Link>
          ),
        })}
      </p>
      <p className="dispatch-card__status" aria-live="polite">
        {status.kind === 'loading' ? t('dispatch.status.loading') : null}
        {status.kind === 'ready' ? statusLabel(status.status) : null}
        {status.kind === 'unavailable'
          ? t('dispatch.status.unavailable')
          : null}
        {status.kind === 'error' ? t('dispatch.status.error') : null}
      </p>
      <details className="dispatch-card__details">
        <summary>{t('dispatch.details')}</summary>
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
  const t = useT();
  const navigate = useNavigate();

  if (!hasConversations) {
    return (
      <div className="empty-chat conversation-empty-state" role="status">
        <div className="empty-chat-icon" aria-hidden="true">
          <span>✦</span>
        </div>
        <h1>{t('transcript.empty.title')}</h1>
        <p>{t('transcript.empty.body')}</p>
        <button type="button" onClick={() => navigate('/agents')}>
          {t('transcript.empty.action')}
        </button>
      </div>
    );
  }

  if (conversationId === null) {
    return <StateMessage>{t('transcript.selectConversation')}</StateMessage>;
  }

  if (state === null || state.status === 'loading') {
    return <StateMessage>{t('transcript.loading')}</StateMessage>;
  }

  if (state.status === 'error') {
    return (
      <div className="empty-chat" role="alert">
        <p>{state.error ?? t('transcript.loadError')}</p>
        <button type="button" onClick={onRetry}>
          {t('common.retry')}
        </button>
      </div>
    );
  }

  if (state.messages.length === 0) {
    return <StateMessage>{t('transcript.noMessages')}</StateMessage>;
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
      className="chat-transcript scroll-region"
      aria-live="polite"
      aria-label={t('transcript.label')}
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
          {t('transcript.awaitingReply')}
        </p>
      ) : null}
    </div>
  );
}
