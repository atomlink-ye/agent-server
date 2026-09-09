import { useEffect, useState } from 'react';
import { useT } from '../../../../i18n';
import { IChat } from '../../../../components/icons';
import { ChatComposer } from '../../../conversations/components/ChatComposer';
import { AssistantMarkdown } from '../../../conversations/components/assistant-markdown';
import { workClient } from '../../clients/work-client';
import { ProductMutationError } from '../../clients/errors';
import type {
  WorkChatMessagesResponse,
  WorkPreparationResponse,
} from '@atomlink-ye/agent-server/product-contract';

export function WorkChatPane({ workId }: { readonly workId: string }) {
  const t = useT();
  const [messages, setMessages] = useState<
    WorkChatMessagesResponse['messages']
  >([]);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(false);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [preparation, setPreparation] =
    useState<WorkPreparationResponse | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [preparationError, setPreparationError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const refresh = () =>
      workClient
        .chat(workId)
        .then((response) => {
          if (active) {
            setMessages(response.messages);
            setPreparation(response.preparation ?? null);
          }
        })
        .catch(() => {
          if (active) setError(true);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [workId]);
  async function send() {
    const next = body.trim();
    if (!next || sending) return;
    setSending(true);
    setError(false);
    setBody('');
    const requestId = pendingRequestId ?? crypto.randomUUID();
    setPendingRequestId(requestId);
    try {
      const message = await workClient.postChat(workId, next, requestId);
      setMessages((current) => [...current, message]);
      setPendingRequestId(null);
    } catch {
      setError(true);
      setBody(next);
    } finally {
      setSending(false);
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
      setPreparation(confirmed);
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
    <section className="work-chat-pane" aria-label={t('work.tab.chat')}>
      <p className="work-shell-kicker">{t('work.chat.shared')}</p>
      {loading ? <p aria-live="polite">{t('work.detail.loading')}</p> : null}
      {error ? <p role="alert">{t('work.chat.loadError')}</p> : null}
      {!loading && !messages.length ? (
        <div className="work-chat-empty-state">
          <div className="work-chat-empty-state__icon" aria-hidden="true">
            <IChat />
          </div>
          <h2>{t('work.chat.emptyTitle')}</h2>
          <p>{t('work.chat.emptyBody')}</p>
        </div>
      ) : null}
      <div className="work-chat-history" aria-live="polite">
        {messages.map((message) => (
          <div
            className={`work-chat-message work-chat-message--${message.role}`}
            key={message.id}
          >
            <span className="work-chat-message__avatar" aria-hidden="true">
              {message.role === 'lead'
                ? 'L'
                : message.role === 'system'
                  ? '·'
                  : 'Y'}
            </span>
            <article
              className="chat-message"
              data-author-type={
                message.role === 'user' ? 'principal' : 'agent_definition'
              }
            >
              <span className="work-chat-message__author">
                {message.role === 'lead'
                  ? 'Lead'
                  : message.role === 'system'
                    ? 'System'
                    : 'User'}
              </span>
              {message.role === 'user' ? (
                <p>{message.body}</p>
              ) : (
                <AssistantMarkdown text={message.body} />
              )}
              {message.status === 'queued' ? (
                <small>{t('work.chat.queued')}</small>
              ) : null}
              {message.status === 'processing' ? (
                <small>{t('work.chat.processing')}</small>
              ) : null}
              {message.status === 'failed' ? (
                <small>
                  {t('work.chat.failed')}{' '}
                  <button
                    type="button"
                    onClick={() =>
                      void workClient
                        .retryChat(workId, message.id)
                        .then(() =>
                          workClient
                            .chat(workId)
                            .then((response) => setMessages(response.messages)),
                        )
                    }
                  >
                    {t('common.retry')}
                  </button>
                </small>
              ) : null}
            </article>
          </div>
        ))}
      </div>
      {preparation ? (
        <aside className="work-preparation-card" aria-live="polite">
          <p className="work-shell-kicker">{t('work.chat.preparationTitle')}</p>
          <p>
            {t('work.chat.preparationStatus')}: {preparation.status}
          </p>
          <p>
            {t('work.chat.preparationVersion')}:{' '}
            {preparation.definition_version_id}
          </p>
          <dl>
            {Object.entries(preparation.candidate_input).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
          </dl>
          {preparation.missing.length ? (
            <p>
              {t('work.chat.missing')}: {preparation.missing.join(', ')}
            </p>
          ) : null}
          {preparation.ambiguities.length ? (
            <p>
              {t('work.chat.ambiguities')}: {preparation.ambiguities.join(', ')}
            </p>
          ) : null}
          {preparation.status === 'ready' ? (
            <button
              type="button"
              onClick={() => void confirmPreparation()}
              disabled={confirming}
            >
              {confirming
                ? t('work.chat.starting')
                : t('work.chat.confirmStart')}
            </button>
          ) : null}
          {preparation.status === 'starting' ? (
            <p>{t('work.chat.starting')}</p>
          ) : null}
          {preparationError ? <p role="alert">{preparationError}</p> : null}
        </aside>
      ) : null}
      <div className="work-chat-composer">
        <ChatComposer
          draft={body}
          sending={sending}
          disabled={false}
          sendError={error ? t('work.chat.sendError') : null}
          canRetry={Boolean(body.trim())}
          fieldLabel={t('composer.field.label')}
          placeholder={t('work.chat.placeholder')}
          sendLabel={t('work.chat.send')}
          sendingLabel={t('work.chat.sending')}
          hint={t('composer.hint')}
          onDraftChange={setBody}
          onSend={() => void send()}
          onRetry={() => void send()}
        />
      </div>
    </section>
  );
}
