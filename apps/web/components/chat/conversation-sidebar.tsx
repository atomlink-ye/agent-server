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

export type TeamProject = {
  readonly root_task_id: string;
  readonly team_run_id: string;
  readonly name: string;
  readonly status: 'working' | 'completed' | 'failed';
  readonly phase: 'planning' | 'working' | 'review' | 'completed' | 'failed';
  readonly final_text: string | null;
  readonly work_items: readonly TeamWorkItem[];
  readonly gates: TeamGates;
  readonly direct_messages: readonly TeamDirectMessage[];
  readonly sessions: readonly TeamSession[];
};

export type TeamWorkItem = {
  readonly work_ref: string;
  readonly subject: string;
  readonly status:
    | 'pending'
    | 'ready'
    | 'in_progress'
    | 'submitted'
    | 'accepted'
    | 'changes_requested'
    | 'blocked';
  readonly assignee_name: string | null;
  readonly dependency_refs: readonly string[];
  readonly latest_attempt: {
    readonly attempt_no: number;
    readonly status: 'queued' | 'running' | 'completed' | 'failed';
    readonly feedback_summary: string | null;
    readonly result_summary: string | null;
  } | null;
};
export type TeamGates = {
  readonly finish_ready: boolean;
  readonly all_work_accepted: boolean;
  readonly no_active_attempts: boolean;
  readonly all_members_idle: boolean;
};
export type TeamDirectMessage = {
  readonly sequence: number;
  readonly sender_name: string;
  readonly recipient_name: string;
  readonly summary: string;
  readonly status: 'delivered' | 'read';
  readonly created_at: string;
};

export type TeamSession = {
  readonly agent_session_id: string;
  readonly name: string;
  readonly role: 'lead' | 'member';
  readonly status: 'queued' | 'running' | 'completed' | 'failed';
  readonly latest_summary: string | null;
};

type ConversationSidebarProps = {
  readonly chats: readonly ChatSummary[];
  readonly project?: TeamProject;
  readonly selectedTeamSessionId?: string;
  readonly selectedProjectRootTaskId?: string;
  readonly selectedSessionId?: string;
  readonly disabled: boolean;
  readonly mobileOpen: boolean;
  readonly onNewChat: () => void;
  readonly onSelect: (sessionId: string) => void;
  readonly onSelectTeam: (session: TeamSession) => void;
  readonly onSelectProject: () => void;
  readonly onCloseMobile: () => void;
};

export function ConversationSidebar({
  chats,
  project,
  selectedTeamSessionId,
  selectedProjectRootTaskId,
  selectedSessionId,
  disabled,
  mobileOpen,
  onNewChat,
  onSelect,
  onSelectTeam,
  onSelectProject,
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
        {project ? (
          <section className="project-directory" aria-label="Project">
            <button
              type="button"
              className="project-directory-heading"
              onClick={onSelectProject}
              disabled={disabled}
              aria-current={
                selectedProjectRootTaskId === project.root_task_id
                  ? 'page'
                  : undefined
              }
            >
              <span>
                <span className="sidebar-section-label">Project</span>
                <strong>{project.name}</strong>
              </span>
              <span className={`project-status ${project.status}`}>
                {statusLabel(project.status)}
              </span>
            </button>
            <div className="project-session-list">
              {project.sessions.map((session) => (
                <button
                  key={session.agent_session_id}
                  type="button"
                  className={`project-session-item ${session.agent_session_id === selectedTeamSessionId ? 'is-selected' : ''}`}
                  aria-current={
                    session.agent_session_id === selectedTeamSessionId
                      ? 'page'
                      : undefined
                  }
                  disabled={disabled}
                  onClick={() => onSelectTeam(session)}
                >
                  <span className="project-session-main">
                    <strong>{session.name}</strong>
                    <small>
                      {session.role === 'lead' ? 'Lead' : 'Member'} · Agent
                      Session
                    </small>
                  </span>
                  <span className={`project-session-status ${session.status}`}>
                    {statusLabel(session.status)}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
        <div className="sidebar-section-label">Chats</div>
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

function statusLabel(value: TeamProject['status'] | TeamSession['status']) {
  return value === 'working' || value === 'running'
    ? 'Working'
    : value === 'failed'
      ? 'Failed'
      : value === 'queued'
        ? 'Queued'
        : 'Completed';
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
