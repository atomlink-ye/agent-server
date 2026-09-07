import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { createConversation } from '../conversations/conversations-gateway';
import { ApiTransportError } from '../../api/transport';
import { isResourceNotFound } from '../../api/feature-availability';
import { isValidDetailId } from '../../app/router/detail-id';
import { NotFoundContent } from '../../app/router/NotFoundPage';
import {
  loadCoworkers,
  loadCoworkerProfile,
  type CoworkerProfile,
} from './agents-gateway';
import type { Coworker } from './contracts';
import { CapabilityBuilder, NewCoworkerForm } from './AuthoringPanels';
import { CoworkerHomeFiles } from './CoworkerHomeFiles';
import { CoworkerRecentActivity } from './CoworkerRecentActivity';
import TitleBar from '../../app/shell/TitleBar';
import './agents.css';

const BUSY_RUNTIME_STATUSES: ReadonlySet<Coworker['runtimeStatus']> = new Set([
  'working',
  'thinking',
]);

function describeOpenConversationError(reason: unknown): string {
  if (
    reason instanceof ApiTransportError &&
    reason.code === 'chat_runtime_unavailable'
  ) {
    return 'This Coworker is handling another conversation right now. Wait for it to finish, then try Chat again.';
  }
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * Cumora shows four status chips (working/thinking/available/resting) and
 * omits its rarely-set fifth state ("waiting") from that row. `draining`
 * plays the same rarely-set role here (nothing in this codebase writes it
 * today), so it keeps the same treatment: a real status, but not a filter
 * pill.
 */
const STATUS_FILTERS: readonly Coworker['runtimeStatus'][] = [
  'working',
  'thinking',
  'available',
  'unavailable',
];

const RUNTIME_STATUS_LABEL: Record<Coworker['runtimeStatus'], string> = {
  working: 'Working',
  thinking: 'Thinking',
  available: 'Available',
  draining: 'Draining',
  unavailable: 'Unavailable',
};

export function AgentsPage() {
  const navigate = useNavigate();
  const { agentId: selectedAgentId } = useParams<{ agentId?: string }>();
  const invalidAgentId =
    selectedAgentId !== undefined && !isValidDetailId('agent', selectedAgentId);
  const [agents, setAgents] = useState<readonly Coworker[]>([]);
  const [profile, setProfile] = useState<CoworkerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profileStatus, setProfileStatus] = useState<
    'idle' | 'loading' | 'ready' | 'not_found' | 'error'
  >('idle');
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [authoring, setAuthoring] = useState<'coworker' | 'capability' | null>(
    null,
  );
  const [reload, setReload] = useState(0);
  const [statusFilter, setStatusFilter] = useState<
    Coworker['runtimeStatus'] | null
  >(null);
  const visibleAgents = statusFilter
    ? agents.filter((agent) => agent.runtimeStatus === statusFilter)
    : agents;
  // Recent activity attributes Work through the Coworker's Work Catalog, so
  // this list is the join key. Memoised on the loaded profile so the activity
  // fetch keys off the profile rather than every render.
  const capabilityDefinitionIds = useMemo(
    () => (profile?.workCatalog ?? []).map((item) => item.definitionId),
    [profile],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void loadCoworkers().then(
      (items) => {
        if (!active) return;
        setAgents(items);
        setLoading(false);
        if (!selectedAgentId && items[0] && authoring !== 'coworker')
          navigate(`/agents/${encodeURIComponent(items[0].id)}`, {
            replace: true,
          });
      },
      (reason: unknown) => {
        if (!active) return;
        setError('Unable to load Agents. Check your connection and try again.');
        setLoading(false);
      },
    );
    return () => {
      active = false;
    };
  }, [navigate, selectedAgentId, reload, authoring]);

  useEffect(() => {
    if (!selectedAgentId || invalidAgentId) {
      setProfile(null);
      setProfileStatus('idle');
      return;
    }
    let active = true;
    setProfile(null);
    setProfileStatus('loading');
    void loadCoworkerProfile(selectedAgentId).then(
      (next) => {
        if (!active) return;
        setProfile(next);
        setProfileStatus('ready');
      },
      (reason: unknown) => {
        if (!active) return;
        setProfileStatus(
          isResourceNotFound(reason, 'agent_not_found') ? 'not_found' : 'error',
        );
      },
    );
    return () => {
      active = false;
    };
  }, [invalidAgentId, selectedAgentId, reload]);

  async function openConversation(): Promise<void> {
    if (!selectedAgentId || opening) return;
    setOpening(true);
    setError(null);
    try {
      const conversation = await createConversation(selectedAgentId);
      navigate(`/conversations/${encodeURIComponent(conversation.id)}`);
    } catch (reason) {
      setError(describeOpenConversationError(reason));
      setOpening(false);
    }
  }

  function startCapability(versionId: string): void {
    if (!selectedAgentId) return;
    navigate(
      `/work?new=1&agent=${encodeURIComponent(selectedAgentId)}&capability=${encodeURIComponent(versionId)}`,
    );
  }

  return (
    <>
      <aside className="sidebar agents-pane" aria-label="Agents navigation">
        <div className="pane-heading">
          <div>
            <span className="eyebrow">Coworkers</span>
            <h1>Agents</h1>
          </div>
          <button
            className="agents-new-coworker-cta"
            type="button"
            aria-label="New Coworker"
            data-testid="new-coworker-cta"
            onClick={() => {
              setAuthoring('coworker');
              setError(null);
            }}
          >
            + New Coworker
          </button>
        </div>
        {agents.length > 0 ? (
          <div
            className="agents-status-filters"
            role="group"
            aria-label="Filter Coworkers by status"
          >
            {STATUS_FILTERS.map((status) => {
              const count = agents.filter(
                (agent) => agent.runtimeStatus === status,
              ).length;
              const active = statusFilter === status;
              return (
                <button
                  key={status}
                  type="button"
                  className="filter-chip"
                  aria-pressed={active}
                  data-active={active ? 'true' : 'false'}
                  onClick={() => setStatusFilter(active ? null : status)}
                >
                  {RUNTIME_STATUS_LABEL[status]} · {count}
                </button>
              );
            })}
          </div>
        ) : null}
        <div className="agents-list">
          {loading && agents.length === 0 ? (
            <p className="pane-placeholder">Loading Coworkers…</p>
          ) : null}
          {!loading && agents.length === 0 ? (
            <div className="pane-placeholder">
              <p>No Coworkers yet.</p>
              <button type="button" onClick={() => setAuthoring('coworker')}>
                Create your first Coworker
              </button>
            </div>
          ) : null}
          {!loading && agents.length > 0 && visibleAgents.length === 0 ? (
            <p className="pane-placeholder">
              No Coworkers are{' '}
              {statusFilter ? RUNTIME_STATUS_LABEL[statusFilter] : ''} right
              now.
            </p>
          ) : null}
          {visibleAgents.map((agent) => (
            <button
              type="button"
              className="agents-list-item"
              data-active={
                selectedAgentId === agent.id && authoring !== 'coworker'
                  ? 'true'
                  : 'false'
              }
              aria-current={
                selectedAgentId === agent.id && authoring !== 'coworker'
                  ? 'page'
                  : undefined
              }
              key={agent.id}
              onClick={() => {
                setAuthoring(null);
                navigate(`/agents/${encodeURIComponent(agent.id)}`);
              }}
            >
              <span className="agents-avatar" aria-hidden="true">
                {agent.displayName.slice(0, 1).toUpperCase()}
              </span>
              <span className="agents-list-copy">
                <strong>{agent.displayName}</strong>
                <small>{agent.roleLabel ?? 'Coworker'}</small>
              </span>
              <span
                className={`agents-runtime agents-runtime--${agent.runtimeStatus}`}
              >
                {RUNTIME_STATUS_LABEL[agent.runtimeStatus]}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <main className="chat-panel agents-main">
        <TitleBar section="Agents" />
        {authoring === 'coworker' && !invalidAgentId ? (
          <NewCoworkerForm
            onCancel={() => setAuthoring(null)}
            onCreated={({ conversationId }) =>
              navigate(`/conversations/${encodeURIComponent(conversationId)}`)
            }
          />
        ) : null}
        {authoring === 'capability' && profile && !invalidAgentId ? (
          <CapabilityBuilder
            agent={profile.agent}
            onCancel={() => setAuthoring(null)}
            onSaved={async () => setReload((value) => value + 1)}
            onStart={startCapability}
          />
        ) : null}
        {authoring === null || invalidAgentId ? (
          <section className="agents-detail" aria-label="Agent profile">
            {error && !invalidAgentId ? (
              <p className="agents-error" role="alert">
                {error}
              </p>
            ) : null}
            {invalidAgentId ? (
              <NotFoundContent
                title="This Agent link is invalid."
                to="/agents"
                linkLabel="Back to Agents"
                eyebrow="Agent link"
                mark="!"
                variant="detail"
              >
                Check the link, or return to Agents.
              </NotFoundContent>
            ) : profileStatus === 'not_found' ? (
              <NotFoundContent
                title="This Agent is unavailable."
                to="/agents"
                linkLabel="Back to Agents"
                eyebrow="Agent unavailable"
              >
                It may have been removed, or you may not have access.
              </NotFoundContent>
            ) : profileStatus === 'error' ? (
              <NotFoundContent
                title="This Agent couldn’t be loaded."
                to="/agents"
                linkLabel="Back to Agents"
                eyebrow="Agent unavailable"
                onRetry={() => setReload((value) => value + 1)}
                mark="!"
              >
                Try again in a moment, or return to Agents.
              </NotFoundContent>
            ) : profileStatus === 'loading' ? (
              <div className="work-main-empty" role="status">
                <span className="work-main-icon" aria-hidden="true">
                  ◎
                </span>
                <h1>Loading Agent…</h1>
                <p>Opening this Agent&apos;s profile.</p>
              </div>
            ) : !profile ? (
              <div className="work-main-empty">
                <span className="work-main-icon">◎</span>
                <h1>
                  {agents.length ? 'Choose a Coworker' : 'Create a Coworker'}
                </h1>
                <p>
                  {agents.length
                    ? 'Open a Coworker profile.'
                    : 'Start with a name, role, and the kind of help you want.'}
                </p>
                {!agents.length ? (
                  <button
                    className="agents-primary"
                    type="button"
                    onClick={() => setAuthoring('coworker')}
                  >
                    New Coworker
                  </button>
                ) : null}
              </div>
            ) : (
              <>
                <header className="agents-profile-header">
                  <span className="agents-profile-avatar" aria-hidden="true">
                    {profile.agent.displayName.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="agents-profile-copy">
                    <h1>{profile.agent.displayName}</h1>
                    <p className="agents-profile-meta">
                      {profile.agent.roleLabel ?? 'Coworker'}
                      <span
                        className={`agents-runtime agents-runtime--${profile.agent.runtimeStatus}`}
                      >
                        {RUNTIME_STATUS_LABEL[profile.agent.runtimeStatus]}
                      </span>
                      {profile.capabilities.modelPolicyRef ? (
                        <span
                          className="agents-host-badge"
                          title="Model policy backing this Coworker (this project has no paired-device concept, so the model/engine reference stands in for Cumora's host badge)"
                        >
                          {profile.capabilities.modelPolicyRef}
                        </span>
                      ) : null}
                    </p>
                    {/*
                      The Coworker's own words appear exactly once on this
                      page. The former About card repeated this same summary
                      and pushed the Work capabilities below the fold.
                    */}
                    <p className="agents-profile-bio">
                      {profile.agent.summary ?? 'No summary provided.'}
                    </p>
                  </div>
                  <div className="agents-profile-actions">
                    <button
                      className="agents-primary"
                      type="button"
                      onClick={() => void openConversation()}
                      disabled={
                        opening ||
                        profile.agent.runtimeStatus === 'draining' ||
                        profile.agent.runtimeStatus === 'unavailable' ||
                        BUSY_RUNTIME_STATUSES.has(profile.agent.runtimeStatus)
                      }
                      title={
                        BUSY_RUNTIME_STATUSES.has(profile.agent.runtimeStatus)
                          ? 'This Coworker is handling another conversation right now. Try again once it finishes.'
                          : undefined
                      }
                    >
                      {opening
                        ? 'Opening…'
                        : BUSY_RUNTIME_STATUSES.has(profile.agent.runtimeStatus)
                          ? 'Busy'
                          : 'Chat'}
                    </button>
                    <button
                      className="agents-whisper"
                      type="button"
                      disabled
                      title="Whispers are read-only."
                    >
                      Whisper
                    </button>
                  </div>
                </header>

                {/*
                  First screen order answers, top to bottom: who is this
                  (header), what can I ask it to do (Capabilities), and what
                  has it done lately (Activity). Context files are supporting
                  material, so they sit under that pair.
                */}
                <div className="agents-first-screen">
                  <section
                    className="agents-capabilities"
                    aria-labelledby="coworker-capabilities-heading"
                  >
                    <div className="agents-section-heading">
                      <div>
                        <span className="eyebrow">Can do</span>
                        <h2 id="coworker-capabilities-heading">
                          Formal capabilities
                        </h2>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAuthoring('capability')}
                      >
                        + Add capability
                      </button>
                    </div>
                    {profile.workCatalog.length ? (
                      <div className="agents-capability-grid">
                        {profile.workCatalog.map((capability) => (
                          <article
                            className="agents-card agents-capability-card"
                            key={capability.definitionId}
                          >
                            <div>
                              <h3>{humanize(capability.name)}</h3>
                              <p>
                                {capability.description ??
                                  'Formal Work capability'}
                              </p>
                            </div>
                            <div className="agents-capability-meta">
                              <span>
                                {
                                  Object.keys(capability.inputSchema.properties)
                                    .length
                                }{' '}
                                inputs
                              </span>
                            </div>
                            <button
                              className="agents-primary"
                              type="button"
                              onClick={() =>
                                startCapability(capability.definitionVersionId)
                              }
                            >
                              Start Work
                            </button>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="agents-empty-capabilities">
                        <p>This Coworker has no formal Capabilities yet.</p>
                        <button
                          type="button"
                          onClick={() => setAuthoring('capability')}
                        >
                          Teach the first capability
                        </button>
                      </div>
                    )}
                  </section>

                  <CoworkerRecentActivity
                    key={profile.agent.id}
                    agentId={profile.agent.id}
                    capabilityDefinitionIds={capabilityDefinitionIds}
                  />
                </div>

                <CoworkerHomeFiles
                  key={profile.agent.id}
                  agent={profile.agent}
                />

                <details className="agents-advanced agents-technical-details">
                  <summary>Advanced · runtime and package details</summary>
                  <div className="agents-card-grid">
                    <article className="agents-card">
                      <h3>Runtime</h3>
                      <dl>
                        <dt>Status</dt>
                        <dd>
                          {RUNTIME_STATUS_LABEL[profile.agent.runtimeStatus]}
                        </dd>
                        <dt>Published version</dt>
                        <dd className="agents-mono">
                          {profile.agent.activeAgentVersionId}
                        </dd>
                        <dt>Model policy</dt>
                        <dd>{profile.capabilities.modelPolicyRef}</dd>
                      </dl>
                    </article>
                    <article className="agents-card">
                      <h3>Package capabilities</h3>
                      <p>
                        <strong>Tools</strong>
                      </p>
                      <div className="agents-chips">
                        {profile.capabilities.tools.length ? (
                          profile.capabilities.tools.map((tool) => (
                            <span key={tool}>{tool}</span>
                          ))
                        ) : (
                          <em>No declared tools</em>
                        )}
                      </div>
                      <p>
                        <strong>Skills</strong>
                      </p>
                      <div className="agents-chips">
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
                </details>
              </>
            )}
          </section>
        ) : null}
      </main>
    </>
  );
}

function humanize(value: string): string {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}

export default AgentsPage;
