import { useEffect, useRef } from 'react';

export type ChatSummary = {
  readonly session_id: string;
  readonly title: string;
  readonly preview: string | null;
  readonly preview_role: 'user' | 'assistant' | null;
  readonly last_message_at: string | null;
  readonly created_at: string;
  readonly status?: 'Working' | 'Completed' | 'Failed' | 'Ready';
};

type ConversationSidebarProps = {
  readonly chats: readonly ChatSummary[];
  readonly selectedSessionId?: string;
  readonly disabled: boolean;
  readonly mobileOpen: boolean;
  readonly onNewChat: () => void;
  readonly onSelect: (sessionId: string) => void;
  readonly onCloseMobile: () => void;
};

export function ConversationSidebar({
  chats,
  selectedSessionId,
  disabled,
  mobileOpen,
  onNewChat,
  onSelect,
  onCloseMobile,
}: ConversationSidebarProps) {
  const firstControlRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (mobileOpen && !wasOpenRef.current) {
      wasOpenRef.current = true;
      firstControlRef.current?.focus();
    } else if (wasOpenRef.current) {
      wasOpenRef.current = false;
      document.querySelector<HTMLButtonElement>('.mobile-menu-button')?.focus();
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (mobileOpen && event.key === 'Escape') onCloseMobile();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen, onCloseMobile]);
  return (
    <>
      <button
        className={`sidebar-backdrop ${mobileOpen ? 'is-open' : ''}`}
        aria-label="Close conversations"
        onClick={onCloseMobile}
        tabIndex={mobileOpen ? 0 : -1}
      />
      <aside
        className={`conversation-sidebar ${mobileOpen ? 'is-open' : ''}`}
        aria-label="Conversations"
      >
        <div className="sidebar-brand">
          <span className="brand-mark" aria-hidden="true">
            A
          </span>
          <span>Agent Server</span>
        </div>
        <button
          ref={firstControlRef}
          className="new-chat-button"
          type="button"
          disabled={disabled}
          onClick={onNewChat}
        >
          <span aria-hidden="true">+</span> New Chat
        </button>
        <div className="sidebar-section-label">Recent conversations</div>
        <nav className="conversation-list" aria-label="Recent conversations">
          {chats.length === 0 ? (
            <p className="sidebar-empty">No conversations yet.</p>
          ) : null}
          {chats.map((chat) => (
            <button
              key={chat.session_id}
              type="button"
              className={`conversation-item ${chat.session_id === selectedSessionId ? 'is-selected' : ''}`}
              aria-current={
                chat.session_id === selectedSessionId ? 'page' : undefined
              }
              disabled={disabled}
              onClick={() => onSelect(chat.session_id)}
            >
              <span className="conversation-item-top">
                <strong>{chat.title || 'New chat'}</strong>
                <time>
                  {relativeTime(chat.last_message_at ?? chat.created_at)}
                </time>
              </span>
              <span className="conversation-item-bottom">
                <span className={`conversation-status ${statusFor(chat)}`}>
                  {statusFor(chat)}
                </span>
                <span className="conversation-preview">
                  {chat.preview ?? 'New conversation'}
                </span>
              </span>
            </button>
          ))}
        </nav>
        {disabled ? (
          <p className="sidebar-note">
            Finish this response before switching conversations.
          </p>
        ) : null}
      </aside>
    </>
  );
}

function statusFor(chat: ChatSummary) {
  if (chat.status) return chat.status;
  if (!chat.preview) return 'Ready';
  return chat.preview_role === 'assistant' ? 'Completed' : 'Working';
}

function relativeTime(value: string) {
  const elapsed = Date.now() - Date.parse(value);
  if (!Number.isFinite(elapsed) || elapsed < 0) return 'now';
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 7
    ? `${days}d`
    : new Date(value).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      });
}
