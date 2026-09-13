import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useT } from '../../../../i18n';
import { IChat } from '../../../../components/icons';
import { ChatComposer } from '../../../conversations/components/ChatComposer';
import { AssistantMarkdown } from '../../../conversations/components/assistant-markdown';
import { workClient } from '../../clients/work-client';
import { ProductMutationError } from '../../clients/errors';
import { useAppRuntime } from '../../../../app/providers';
import { workChatScope } from '../../stores/work-chat-mutations';
import type {
  WorkChatMessagesResponse,
  WorkPreparationResponse,
} from '@atomlink-ye/agent-server/product-contract';

export function WorkChatPane({
  workId,
  workRunId,
  onWorkRunStarted,
}: {
  readonly workId: string;
  readonly workRunId?: string | undefined;
  readonly onWorkRunStarted?: (id: string) => void;
}) {
  const [startedRun, setStartedRun] = useState<{
    workId: string;
    id: string;
  } | null>(null);
  const activeRunId =
    workRunId ?? (startedRun?.workId === workId ? startedRun.id : undefined);
  const onRunStarted = useCallback(
    (id: string) => {
      if (onWorkRunStarted) onWorkRunStarted(id);
      else setStartedRun({ workId, id });
    },
    [workId, onWorkRunStarted],
  );
  return (
    <WorkChatConversation
      key={`${workId}:${activeRunId ?? 'preparation'}`}
      workId={workId}
      workRunId={activeRunId}
      onRunStarted={onRunStarted}
    />
  );
}

function WorkChatConversation({
  workId,
  workRunId,
  onRunStarted,
}: {
  readonly workId: string;
  readonly workRunId?: string | undefined;
  readonly onRunStarted: (id: string) => void;
}) {
  const t = useT();
  const [messages, setMessages] = useState<
    WorkChatMessagesResponse['messages']
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const { workChatMutationStore } = useAppRuntime();
  const mutationScope = workChatScope(workId, workRunId);
  const mutationSnapshot = useSyncExternalStore(
    workChatMutationStore.subscribe,
    workChatMutationStore.getSnapshot,
  );
  const mutation =
    mutationSnapshot[mutationScope] ?? workChatMutationStore.get(mutationScope);
  const [preparation, setPreparation] =
    useState<WorkPreparationResponse | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [preparationError, setPreparationError] = useState<string | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const messagesRef = useRef(messages);
  const preparationRef = useRef(preparation);
  const loadingRef = useRef(true);
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );
  useEffect(() => {
    let active = true;
    const refresh = () =>
      workClient
        .chat(workId, workRunId)
        .then((response) => {
          if (active) {
            if (
              !workRunId &&
              response.preparation?.status === 'started' &&
              response.preparation.work_run_id
            ) {
              onRunStarted(response.preparation.work_run_id);
              return;
            }
            if (!sameMessages(messagesRef.current, response.messages)) {
              messagesRef.current = response.messages;
              setMessages(response.messages);
            }
            const nextPreparation = response.preparation ?? null;
            if (!samePreparation(preparationRef.current, nextPreparation)) {
              preparationRef.current = nextPreparation;
              setPreparation(nextPreparation);
            }
          }
        })
        .catch(() => {
          if (active) setError(true);
        })
        .finally(() => {
          if (active && loadingRef.current) {
            loadingRef.current = false;
            setLoading(false);
          }
        });
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [workId, workRunId, onRunStarted]);
  useLayoutEffect(() => {
    const history = historyRef.current;
    if (!history || !stickToBottomRef.current) return;
    history.scrollTop = history.scrollHeight;
  }, [messages, preparation, loading, error]);

  function rememberScrollPosition() {
    const history = historyRef.current;
    if (!history) return;
    const distanceFromBottom =
      history.scrollHeight - history.clientHeight - history.scrollTop;
    stickToBottomRef.current = distanceFromBottom <= 80;
  }
  async function send() {
    setError(false);
    try {
      const message = await workChatMutationStore.send(
        mutationScope,
        (body, requestId) =>
          workClient.postChat(workId, body, requestId, workRunId),
      );
      if (!message) return;
      if (!mountedRef.current) return;
      setMessages((current) => {
        const updated = [...current, message];
        messagesRef.current = updated;
        return updated;
      });
    } catch {
      if (mountedRef.current) setError(true);
    }
  }
  async function confirmPreparation() {
    if (!preparation || preparation.status !== 'ready' || confirming) return;
    setConfirming(true);
    setError(false);
    try {
      const confirmed = await workClient.confirmPreparation(
        workId,
        preparation.id,
        preparation.revision,
      );
      preparationRef.current = confirmed;
      setPreparation(confirmed);
      if (confirmed.work_run_id) onRunStarted(confirmed.work_run_id);
    } catch (error) {
      if (
        error instanceof ProductMutationError &&
        (error.code === 'work_preparation_version_mismatch' ||
          error.code === 'work_preparation_revision_mismatch')
      ) {
        setPreparationError(t('work.chat.versionMismatch'));
      } else {
        setError(true);
      }
    } finally {
      setConfirming(false);
    }
  }
  return (
    <section
      className="work-chat-pane"
      aria-label={t(
        workRunId ? 'work.run.conversation' : 'work.record.preparation',
      )}
    >
      <p className="work-shell-kicker">
        {t(workRunId ? 'work.chat.runLead' : 'work.chat.preparationTitle')}
      </p>
      <div
        className="work-chat-history scroll-region"
        aria-live="polite"
        ref={historyRef}
        onScroll={rememberScrollPosition}
      >
        {loading ? <p>{t('work.detail.loading')}</p> : null}
        {error ? <p role="alert">{t('work.chat.loadError')}</p> : null}
        {!loading && !messages.length ? (
          <div className="work-chat-empty-state">
            <div className="work-chat-empty-state__icon" aria-hidden="true">
              <IChat />
            </div>
            <h2>
              {t(
                workRunId ? 'work.chat.runEmptyTitle' : 'work.chat.emptyTitle',
              )}
            </h2>
            <p>
              {t(workRunId ? 'work.chat.runEmptyBody' : 'work.chat.emptyBody')}
            </p>
          </div>
        ) : null}
        {messages.map((message) => (
          <div
            className={`work-chat-message work-chat-message--${message.role}`}
            key={message.id}
          >
            <span className="work-chat-message__avatar" aria-hidden="true">
              {message.role === 'lead'
                ? t('work.chat.role.lead').slice(0, 1)
                : message.role === 'system'
                  ? '·'
                  : t('work.chat.role.user').slice(0, 1)}
            </span>
            <article
              className="chat-message"
              data-author-type={
                message.role === 'user' ? 'principal' : 'agent_definition'
              }
            >
              <span className="work-chat-message__author">
                {message.role === 'lead'
                  ? t(
                      workRunId
                        ? 'work.scope.conversationAssistant'
                        : 'work.chat.role.lead',
                    )
                  : message.role === 'system'
                    ? t('work.chat.role.system')
                    : t('work.chat.role.user')}
              </span>
              {message.role === 'user' ? (
                <p>{message.body}</p>
              ) : (
                <AssistantMarkdown text={message.body} />
              )}
              {message.status === 'queued' ? (
                <small>
                  {t(
                    workRunId
                      ? 'work.scope.conversationQueued'
                      : 'work.chat.queued',
                  )}
                </small>
              ) : null}
              {message.status === 'processing' ? (
                <small>
                  {t(
                    workRunId
                      ? 'work.scope.conversationProcessing'
                      : 'work.chat.processing',
                  )}
                </small>
              ) : null}
              {message.status === 'failed' ? (
                <small>
                  {t('work.chat.failed')}{' '}
                  <button
                    type="button"
                    onClick={() =>
                      void workClient
                        .retryChat(workId, message.id, workRunId)
                        .then(() =>
                          workClient
                            .chat(workId, workRunId)
                            .then((response) => {
                              messagesRef.current = response.messages;
                              setMessages(response.messages);
                            }),
                        )
                        .catch(() => setError(true))
                    }
                  >
                    {t('common.retry')}
                  </button>
                </small>
              ) : null}
            </article>
          </div>
        ))}
        {!workRunId && preparation ? (
          <aside className="work-preparation-card" aria-live="polite">
            <p className="work-shell-kicker">
              {t('work.chat.preparationTitle')}
            </p>
            <p role="status">
              {t(`work.chat.preparation.${preparation.status}`)}
            </p>
            <p>{t(`work.chat.next.${preparation.status}`)}</p>
            <dl>
              {Object.entries(preparation.candidate_input).map(
                ([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{String(value)}</dd>
                  </div>
                ),
              )}
            </dl>
            {preparation.missing.length ? (
              <p>
                {t('work.chat.missing')}: {preparation.missing.join(', ')}
              </p>
            ) : null}
            {preparation.ambiguities.length ? (
              <p>
                {t('work.chat.ambiguities')}:{' '}
                {preparation.ambiguities.join(', ')}
              </p>
            ) : null}
            {preparation.status === 'ready' ||
            preparation.status === 'starting' ? (
              <button
                type="button"
                onClick={() => void confirmPreparation()}
                disabled={confirming || preparation.status === 'starting'}
                aria-busy={confirming || preparation.status === 'starting'}
              >
                {confirming || preparation.status === 'starting'
                  ? t('work.chat.starting')
                  : t('work.chat.confirmStart')}
              </button>
            ) : null}
            {preparationError ? <p role="alert">{preparationError}</p> : null}
          </aside>
        ) : null}
      </div>
      <div className="work-chat-composer">
        <ChatComposer
          draft={mutation.draft}
          sending={mutation.status === 'sending'}
          disabled={false}
          sendError={
            mutation.status === 'failed' ? t('work.chat.sendError') : null
          }
          canRetry={mutation.status === 'failed'}
          fieldLabel={t('composer.field.label')}
          placeholder={t(
            workRunId ? 'work.chat.runPlaceholder' : 'work.chat.placeholder',
          )}
          sendLabel={t(
            workRunId ? 'work.scope.conversationSend' : 'work.chat.send',
          )}
          sendingLabel={t('work.chat.sending')}
          hint={t('composer.hint')}
          onDraftChange={(draft) =>
            workChatMutationStore.setDraft(mutationScope, draft)
          }
          onSend={() => void send()}
          onRetry={() => void send()}
        />
      </div>
    </section>
  );
}

function sameMessages(
  current: WorkChatMessagesResponse['messages'],
  next: WorkChatMessagesResponse['messages'],
) {
  return (
    current.length === next.length &&
    current.every((message, index) => {
      const candidate = next[index];
      return (
        candidate !== undefined &&
        message.id === candidate.id &&
        message.status === candidate.status &&
        message.body === candidate.body
      );
    })
  );
}

function samePreparation(
  current: WorkPreparationResponse | null,
  next: WorkPreparationResponse | null,
) {
  return (
    current?.id === next?.id &&
    current?.revision === next?.revision &&
    current?.status === next?.status
  );
}
