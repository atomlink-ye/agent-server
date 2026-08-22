import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import type { ChatCommands, Coworker } from '../components/chat/contracts';
import { loadCoworkerProfile, type CoworkerProfile } from '../api/agents';
import TitleBar from './TitleBar';

export function AgentsSurface({
  commands,
}: {
  readonly commands: ChatCommands;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const selectedAgentId = useMemo(() => {
    const match = location.pathname.match(/^\/agents\/([^/]+)$/u);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  }, [location.pathname]);
  const [agents, setAgents] = useState<readonly Coworker[]>([]);
  const [profile, setProfile] = useState<CoworkerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void commands.loadCoworkers().then(
      (items) => {
        if (!active) return;
        setAgents(items);
        setLoading(false);
        if (!selectedAgentId && items[0])
          navigate(`/agents/${encodeURIComponent(items[0].id)}`, {
            replace: true,
          });
      },
      (reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setLoading(false);
      },
    );
    return () => {
      active = false;
    };
  }, [commands, navigate, selectedAgentId]);

  useEffect(() => {
    if (!selectedAgentId) {
      setProfile(null);
      return;
    }
    let active = true;
    setError(null);
    void loadCoworkerProfile(selectedAgentId).then(
      (next) => active && setProfile(next),
      (reason: unknown) =>
        active &&
        setError(reason instanceof Error ? reason.message : String(reason)),
    );
    return () => {
      active = false;
    };
  }, [selectedAgentId]);

  async function openConversation(): Promise<void> {
    if (!selectedAgentId || opening) return;
    setOpening(true);
    setError(null);
    try {
      const conversation = await commands.createConversation(selectedAgentId);
      navigate('/', { state: { returnConversationId: conversation.id } });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setOpening(false);
    }
  }

  return (
    <>
      <aside className="sidebar n3-pane" aria-label="Agents navigation">
        <div className="pane-heading">
          <div>
            <span className="eyebrow">Coworkers</span>
            <h1>Agents</h1>
          </div>
        </div>
        <div className="n3-list">
          {loading && agents.length === 0 ? (
            <p className="pane-placeholder">Loading Agents…</p>
          ) : null}
          {agents.map((agent) => (
            <button
              type="button"
              className="n3-list-item"
              data-active={selectedAgentId === agent.id ? 'true' : 'false'}
              aria-current={selectedAgentId === agent.id ? 'page' : undefined}
              key={agent.id}
              onClick={() =>
                navigate(`/agents/${encodeURIComponent(agent.id)}`)
              }
            >
              <span className="n3-avatar" aria-hidden="true">
                {agent.displayName.slice(0, 1).toUpperCase()}
              </span>
              <span>
                <strong>{agent.displayName}</strong>
                <small>{agent.roleLabel ?? 'Coworker'}</small>
              </span>
              <span className={`n3-runtime n3-runtime--${agent.runtimeStatus}`}>
                {agent.runtimeStatus}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <main className="chat-panel n3-main">
        <TitleBar section="Agents" />
        <section className="n3-detail" aria-label="Agent profile">
          {error ? (
            <p className="n3-error" role="alert">
              {error}
            </p>
          ) : null}
          {!profile ? (
            <div className="work-main-empty">
              <span className="work-main-icon">◎</span>
              <h1>Choose an Agent</h1>
              <p>Open a canonical Coworker profile.</p>
            </div>
          ) : (
            <>
              <header className="n3-profile-header">
                <span className="n3-profile-avatar" aria-hidden="true">
                  {profile.agent.displayName.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <span className="eyebrow">AI Coworker</span>
                  <h1>{profile.agent.displayName}</h1>
                  <p>{profile.agent.roleLabel ?? 'Agent'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void openConversation()}
                  disabled={
                    opening || profile.agent.runtimeStatus !== 'available'
                  }
                >
                  {opening ? 'Opening…' : 'Open conversation'}
                </button>
              </header>
              <div className="n3-card-grid">
                <article className="n3-card">
                  <h2>About</h2>
                  <p>{profile.agent.summary ?? 'No summary provided.'}</p>
                  <dl>
                    <dt>Runtime</dt>
                    <dd>{profile.agent.runtimeStatus}</dd>
                    <dt>Published version</dt>
                    <dd className="n3-mono">
                      {profile.agent.activeAgentVersionId}
                    </dd>
                    <dt>Model policy</dt>
                    <dd>{profile.capabilities.modelPolicyRef}</dd>
                  </dl>
                </article>
                <article className="n3-card">
                  <h2>Capabilities</h2>
                  <h3>Tools</h3>
                  <div className="n3-chips">
                    {profile.capabilities.tools.length ? (
                      profile.capabilities.tools.map((tool) => (
                        <span key={tool}>{tool}</span>
                      ))
                    ) : (
                      <em>No declared tools</em>
                    )}
                  </div>
                  <h3>Skills</h3>
                  <div className="n3-chips">
                    {profile.capabilities.skills.length ? (
                      profile.capabilities.skills.map((skill) => (
                        <span key={skill}>{skill}</span>
                      ))
                    ) : (
                      <em>No declared skills</em>
                    )}
                  </div>
                </article>
              </div>
            </>
          )}
        </section>
      </main>
    </>
  );
}

export default AgentsSurface;
