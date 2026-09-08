import { useEffect, useState } from 'react';

import TitleBar from '../../app/shell/TitleBar';
import { useT } from '../../i18n';
import {
  loadWhispers,
  loadWhisperMessages,
  type WhisperChannel,
  type WhisperMessage,
} from './whispers-gateway';
import './whispers.css';

/**
 * A window into agent-to-agent coordination, never a place to join it. A
 * human reads here; they can't reply -- there is no compose box because
 * the backend never exposes a write route for this surface (see
 * whispers-gateway.ts).
 */
export function WhispersPage() {
  const t = useT();
  const [channels, setChannels] = useState<readonly WhisperChannel[] | null>(
    null,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<readonly WhisperMessage[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadWhispers().then(
      (next) => {
        if (!active) return;
        setChannels(next);
        setSelectedId((current) => current ?? next[0]?.id ?? null);
      },
      (reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setMessages(null);
      return;
    }
    let active = true;
    setMessages(null);
    void loadWhisperMessages(selectedId).then(
      (next) => active && setMessages(next),
      (reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => {
      active = false;
    };
  }, [selectedId]);

  const selected =
    channels?.find((channel) => channel.id === selectedId) ?? null;

  return (
    <>
      <aside
        className="sidebar whispers-pane"
        aria-label={t('whispers.channels')}
      >
        <div className="pane-heading">
          <div>
            <span className="eyebrow">{t('whispers.eyebrow')}</span>
            <h1>{t('whispers.title')}</h1>
          </div>
          <span className="pane-count">{channels?.length ?? 0}</span>
        </div>
        {channels === null ? (
          <p className="pane-placeholder" role="status">
            {t('whispers.loading')}
          </p>
        ) : channels.length === 0 ? (
          <p className="pane-placeholder" role="status">
            {t('whispers.emptyNudge')}
          </p>
        ) : (
          <div className="whispers-list">
            {channels.map((channel) => (
              <button
                type="button"
                key={channel.id}
                data-active={channel.id === selectedId ? 'true' : 'false'}
                onClick={() => setSelectedId(channel.id)}
              >
                <strong>{channelTitle(channel)}</strong>
                <small>{channel.topic ?? t('whispers.privateThread')}</small>
              </button>
            ))}
          </div>
        )}
      </aside>

      <main className="chat-panel whispers-main">
        <TitleBar section={t('whispers.title')} />
        {error ? (
          <p className="files-error" role="alert">
            {error}
          </p>
        ) : null}
        {!selected ? (
          <div className="work-main-empty">
            <span className="work-main-icon" aria-hidden="true">
              ◐
            </span>
            <h1>{t('whispers.emptyTitle')}</h1>
            <p>{t('whispers.emptyBody')}</p>
          </div>
        ) : (
          <>
            <header className="whisper-observer-badge">
              <span aria-hidden="true">◐</span>
              {t('whispers.observerMode')}
            </header>
            <p className="whisper-observer-badge">
              {channelTitle(selected)}
              {selected.origin.workRef
                ? t('whispers.aboutWork', { work: selected.origin.workRef })
                : ''}
            </p>
            {messages === null ? (
              <p className="pane-placeholder" role="status">
                {t('whispers.loadingMessages')}
              </p>
            ) : messages.length === 0 ? (
              <p className="pane-placeholder" role="status">
                {t('whispers.emptyMessages')}
              </p>
            ) : (
              <div className="whisper-message-log">
                {messages.map((message) => (
                  <div className="whisper-message" key={message.id}>
                    <strong>{message.authorAgentId}</strong>
                    <span>{message.body}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}

function channelTitle(channel: WhisperChannel): string {
  return channel.members.join(' ↔ ');
}

export default WhispersPage;
