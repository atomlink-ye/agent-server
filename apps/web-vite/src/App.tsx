import { Navigate, Route, Routes } from 'react-router-dom';

function ChatShell() {
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Chat navigation">
        <div className="wordmark">
          <span className="wordmark-mark" aria-hidden="true">
            ✦
          </span>
          <span>Chat</span>
        </div>

        <button className="new-chat-button" type="button">
          <span aria-hidden="true">＋</span>
          New conversation
        </button>

        <div className="sidebar-section">
          <span className="sidebar-label">Conversations</span>
          <div className="conversation-placeholder">
            <span className="placeholder-dot" aria-hidden="true" />
            Your conversations will appear here
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="profile-avatar" aria-hidden="true">
            PT
          </div>
          <div>
            <strong>Signed in</strong>
            <span>Personal workspace</span>
          </div>
          <span className="online-indicator" aria-label="Online" />
        </div>
      </aside>

      <main className="chat-panel">
        <header className="chat-header">
          <div>
            <span className="eyebrow">Workspace</span>
            <h1>New conversation</h1>
          </div>
          <button className="icon-button" type="button" aria-label="More options">
            ···
          </button>
        </header>

        <section className="chat-content" aria-label="Conversation">
          <div className="empty-chat">
            <div className="empty-chat-icon" aria-hidden="true">
              <span>✦</span>
            </div>
            <span className="eyebrow">A quiet place to start</span>
            <h2>What would you like to explore?</h2>
            <p>Start a conversation whenever you are ready.</p>
          </div>

          <form className="composer" onSubmit={(event) => event.preventDefault()}>
            <label className="sr-only" htmlFor="message">
              Message
            </label>
            <textarea id="message" placeholder="Write a message..." rows={1} />
            <div className="composer-actions">
              <button className="composer-tool" type="button" aria-label="Attach a file">
                ＋
              </button>
              <button className="send-button" type="submit" aria-label="Send message">
                ↑
              </button>
            </div>
          </form>
          <p className="composer-hint">Press Enter to send · Shift + Enter for a new line</p>
        </section>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ChatShell />} />
      <Route path="*" element={<Navigate replace to="/" />} />
    </Routes>
  );
}
