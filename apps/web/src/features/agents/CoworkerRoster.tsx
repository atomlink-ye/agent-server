import type { Coworker } from './contracts';
import { useT } from '../../i18n';
import {
  BUSY_RUNTIME_STATUSES,
  STATUS_FILTERS,
  chatBlocked,
  runtimeStatusLabel,
} from './runtime-status';

export interface CoworkerRosterProps {
  readonly agents: readonly Coworker[];
  readonly loading: boolean;
  readonly statusFilter: Coworker['runtimeStatus'] | null;
  readonly openingAgentId: string | null;
  readonly onFilter: (status: Coworker['runtimeStatus'] | null) => void;
  readonly onOpenProfile: (agentId: string) => void;
  readonly onChat: (agentId: string) => void;
  readonly onNewCoworker: () => void;
}

/**
 * The roster is the Agents landing surface: the whole team on one screen, each
 * card able to start a conversation without a detour through the profile. The
 * profile stays one click away and keeps everything the card cannot honestly
 * show — the Coworker's Capabilities, activity, files and runtime details are
 * not on `/api/agents`, and this view refuses to invent them.
 */
export function CoworkerRoster({
  agents,
  loading,
  statusFilter,
  openingAgentId,
  onFilter,
  onOpenProfile,
  onChat,
  onNewCoworker,
}: CoworkerRosterProps) {
  const t = useT();
  const visibleAgents = statusFilter
    ? agents.filter((agent) => agent.runtimeStatus === statusFilter)
    : agents;
  const empty = agents.length === 0;
  const showingStarterSample =
    agents.length === 1 &&
    agents[0]?.displayName === 'Maya' &&
    agents[0].roleLabel === 'Research Analyst' &&
    agents[0].summary === 'Researches markets and writes concise briefs.';

  return (
    <section className="agents-roster" aria-label={t('agents.roster')}>
      <header className="agents-roster-header">
        <div className="agents-roster-copy">
          <h1>
            {empty ? (
              t('agents.teamStarts')
            ) : (
              <>{t('agents.teamCount', { count: agents.length })}</>
            )}
          </h1>
          <p>{empty ? t('agents.emptyIntro') : t('agents.teamIntro')}</p>
        </div>
        <button
          className="agents-primary agents-roster-new"
          type="button"
          data-testid="new-coworker-cta"
          onClick={onNewCoworker}
        >
          {t('agents.newCoworker')}
        </button>
      </header>

      {showingStarterSample ? (
        <p className="agents-roster-sample" role="note">
          {t('agents.sampleIntro')}
        </p>
      ) : null}

      {empty ? null : (
        <div
          className="agents-status-filters"
          role="group"
          aria-label={t('agents.filter')}
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
                onClick={() => onFilter(active ? null : status)}
              >
                {runtimeStatusLabel(t, status)} · {count}
              </button>
            );
          })}
        </div>
      )}

      {loading && empty ? (
        <p className="agents-roster-note" role="status">
          {t('agents.loading')}
        </p>
      ) : null}

      {!loading && !empty && visibleAgents.length === 0 ? (
        <p className="agents-roster-note">
          {statusFilter
            ? t('agents.filteredEmpty', {
                status: runtimeStatusLabel(t, statusFilter).toLowerCase(),
              })
            : t('agents.empty')}
        </p>
      ) : null}

      <div className="agents-roster-grid">
        {visibleAgents.map((agent) => (
          <CoworkerCard
            key={agent.id}
            agent={agent}
            opening={openingAgentId === agent.id}
            disabled={openingAgentId !== null}
            onOpenProfile={onOpenProfile}
            onChat={onChat}
          />
        ))}
        <button
          className="agents-roster-add"
          type="button"
          data-testid="roster-add-coworker"
          onClick={onNewCoworker}
        >
          <span className="agents-roster-add-mark" aria-hidden="true">
            +
          </span>
          <strong>{t('agents.addCoworker')}</strong>
          <small>{t('agents.addCoworkerHint')}</small>
        </button>
      </div>
    </section>
  );
}

function CoworkerCard({
  agent,
  opening,
  disabled,
  onOpenProfile,
  onChat,
}: {
  readonly agent: Coworker;
  readonly opening: boolean;
  readonly disabled: boolean;
  readonly onOpenProfile: (agentId: string) => void;
  readonly onChat: (agentId: string) => void;
}) {
  const t = useT();
  const busy = BUSY_RUNTIME_STATUSES.has(agent.runtimeStatus);
  return (
    <article className="agents-roster-card">
      <button
        className="agents-roster-identity"
        type="button"
        onClick={() => onOpenProfile(agent.id)}
      >
        <span
          className={`agents-roster-avatar agents-roster-avatar--${agent.runtimeStatus}`}
          aria-hidden="true"
        >
          {agent.displayName.slice(0, 1).toUpperCase()}
        </span>
        <span className="agents-roster-identity-copy">
          <strong>{agent.displayName}</strong>
          <small>{agent.roleLabel ?? t('agents.coworker')}</small>
          <span
            className={`agents-runtime agents-runtime--${agent.runtimeStatus}`}
          >
            {runtimeStatusLabel(t, agent.runtimeStatus)}
          </span>
        </span>
      </button>
      {/*
        Cumora quotes each agent's first-person line. Our summaries are written
        in the third person, so the card gives them a spoken treatment — an
        indented, italic rule — without quotation marks that would put words in
        a Coworker's mouth it never said.
      */}
      {agent.summary ? (
        <p className="agents-roster-bio">{agent.summary}</p>
      ) : (
        <p className="agents-roster-bio agents-roster-bio--empty">
          {t('agents.noSummary')}
        </p>
      )}
      <div className="agents-roster-actions">
        <button
          className="agents-primary"
          type="button"
          disabled={disabled || chatBlocked(agent.runtimeStatus)}
          title={busy ? t('agents.busyConversation') : undefined}
          onClick={() => onChat(agent.id)}
        >
          {opening
            ? t('agents.opening')
            : busy
              ? t('agents.busy')
              : t('agents.chat')}
        </button>
        <button
          className="agents-whisper"
          type="button"
          disabled
          title={t('agents.whispersReadOnly')}
        >
          {t('agents.whisper')}
        </button>
      </div>
    </article>
  );
}

export default CoworkerRoster;
