import { useEffect, useState } from 'react';
import { useT } from '../../../../i18n';
import { workClient } from '../../clients/work-client';
import type { WorkChatMessagesResponse } from '@atomlink-ye/agent-server/product-contract';

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
  useEffect(() => {
    let active = true;
    const refresh = () =>
      workClient
        .chat(workId)
        .then((response) => {
          if (active) setMessages(response.messages);
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
  return (
    <section className="work-chat-pane" aria-label={t('work.tab.chat')}>
      <p className="work-shell-kicker">{t('work.chat.shared')}</p>
      {loading ? <p aria-live="polite">{t('work.detail.loading')}</p> : null}
      {error ? <p role="alert">{t('work.chat.loadError')}</p> : null}
      {!loading && !messages.length ? (
        <>
          <h2>{t('work.chat.emptyTitle')}</h2>
          <p>{t('work.chat.emptyBody')}</p>
        </>
      ) : null}
      <div className="work-chat-history" aria-live="polite">
        {messages.map((message) => (
          <article
            className={`work-chat-message work-chat-message--${message.role}`}
            key={message.id}
          >
            <strong>
              {message.role === 'lead'
                ? 'Lead'
                : message.role === 'system'
                  ? 'System'
                  : 'User'}
            </strong>
            <p>{message.body}</p>
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
        ))}
      </div>
      <form
        className="work-chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label htmlFor="work-chat-message">{t('composer.field.label')}</label>
        <textarea
          id="work-chat-message"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder={t('work.chat.placeholder')}
          rows={3}
          disabled={sending}
        />
        <button type="submit" disabled={sending || !body.trim()}>
          {sending ? t('work.chat.sending') : t('work.chat.send')}
        </button>
        {error ? <p role="alert">{t('work.chat.sendError')}</p> : null}
      </form>
    </section>
  );
}
