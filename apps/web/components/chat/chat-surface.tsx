import { ActivityItem, ActivityPanel } from '@/components/chat/activity-panel';
import { AssistantMarkdown } from '@/components/chat/assistant-markdown';
import type { TeamProject } from '@/components/chat/conversation-sidebar';
import type { ViewStatus } from '@/components/chat/run-details';
import {
  selectCurrentLifecycle,
  selectActivityEntries,
  selectPromptEntries,
  selectUsageEntry,
  selectChildEntriesByParent,
  type TimelineActivityEntry,
  type TimelineEntry,
  type PromptEntry,
  type TimelineState,
} from '@/lib/stream-reducer';
import type { Capabilities } from '@/lib/capabilities';

export type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  status: string;
  task_id: string;
  run_id: string | null;
  created_at?: string;
};

export type TeamTurn = {
  task_id: string;
  run_id: string;
  sequence: number;
  assignment_summary: string;
  result_summary: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed';
};

export type TeamSessionResponse = {
  agent_session_id: string;
  team_run_id: string;
  name: string;
  role: 'lead' | 'member';
  read_only: true;
  turns: TeamTurn[];
};

export type ReplayStatus = 'loading' | 'ready' | 'unavailable';

type Turn = {
  taskId: string;
  runId: string | null;
  user?: Message;
  assistant?: Message;
};

export type ChatSurfaceProps = {
  readonly messages: readonly Message[];
  readonly activeRunId?: string;
  readonly entries: TimelineState;
  readonly capabilities: Capabilities;
  readonly now: string;
  readonly replayStatus: Readonly<Record<string, ReplayStatus>>;
  readonly selectedTeam: boolean;
  readonly selectedOverview: boolean;
  readonly teamProject?: TeamProject;
  readonly teamSession?: TeamSessionResponse;
  readonly status: ViewStatus;
  readonly error?: string;
  readonly retryText: string;
  readonly text: string;
  readonly setText: (value: string) => void;
  readonly pending: boolean;
  readonly onPrompt: (prompt: string) => void;
  readonly onSend: () => void;
  readonly onRetry: () => void;
};

export function ChatSurface({
  messages,
  activeRunId,
  entries,
  capabilities,
  now,
  replayStatus,
  selectedTeam,
  selectedOverview,
  teamProject,
  teamSession,
  status,
  error,
  retryText,
  text,
  setText,
  pending,
  onPrompt,
  onSend,
  onRetry,
}: ChatSurfaceProps) {
  const turns = groupTurns(messages);
  return (
    <section className="conversation-column">
      <div
        className="message-list"
        aria-live={activeRunId ? 'polite' : undefined}
      >
        {selectedOverview && teamProject ? (
          <TeamOverview project={teamProject} />
        ) : null}
        {!selectedTeam &&
        !selectedOverview &&
        !messages.length &&
        status !== 'loading' ? (
          <EmptyState
            canCompose={capabilities.canCompose === true}
            onPrompt={onPrompt}
          />
        ) : null}
        {status === 'loading' ? <LoadingState /> : null}
        {!selectedTeam &&
          !selectedOverview &&
          turns.map((turn) => (
            <TurnView
              key={turn.taskId}
              turn={turn}
              activeRunId={activeRunId}
              entries={entries}
              now={now}
              replayStatus={replayStatus}
            />
          ))}
        {selectedTeam && teamSession ? (
          <TeamTranscript
            session={teamSession}
            timeline={entries}
            now={now}
            replayStatus={replayStatus}
          />
        ) : null}
        {error && status !== 'running' ? (
          <ErrorState
            message={error}
            retryText={retryText}
            canRetry={capabilities.canRetry === true}
            onRetry={onRetry}
          />
        ) : null}
      </div>
      {capabilities.canCompose !== true ? (
        selectedTeam || selectedOverview ? (
          <div className="read-only-session">
            {selectedTeam
              ? 'This Agent Session is read-only.'
              : 'This Team Overview is read-only.'}
          </div>
        ) : null
      ) : (
        <Composer
          text={text}
          setText={setText}
          status={status}
          pending={pending}
          error={error}
          onSend={onSend}
          onRetry={onRetry}
          canCompose={capabilities.canCompose === true}
          hasRetry={
            capabilities.canRetry === true && Boolean(error && retryText)
          }
        />
      )}
    </section>
  );
}

function TurnView({
  turn,
  activeRunId,
  entries,
  now,
  replayStatus,
}: {
  readonly turn: Turn;
  readonly activeRunId?: string;
  readonly entries: TimelineState;
  readonly now: string;
  readonly replayStatus: Readonly<Record<string, ReplayStatus>>;
}) {
  const runId = turn.runId;
  const active = Boolean(runId && runId === activeRunId);
  const prompts = runId ? selectPromptEntries(entries, runId) : [];
  const hasDocument = runId
    ? hasRenderableDocumentEntries(entries, runId)
    : false;
  return (
    <div className="turn">
      {prompts.length > 0 ? (
        <PromptView
          prompt={prompts[0]}
          failed={turn.user?.status === 'failed'}
        />
      ) : (
        <MessageView message={turn.user} />
      )}
      {runId && hasDocument ? (
        <AssistantDocument
          runId={runId}
          entries={entries}
          active={active}
          now={now}
          replayAvailable={replayStatus[runId] !== 'unavailable'}
          replayLoading={active || replayStatus[runId] === 'loading'}
        />
      ) : null}
      {!hasDocument && turn.assistant ? (
        <MessageView message={turn.assistant} />
      ) : null}
      {runId && !hasDocument ? (
        <ActivityPanel
          timeline={entries}
          runId={runId}
          active={active}
          replayAvailable={replayStatus[runId] !== 'unavailable'}
          replayLoading={active || replayStatus[runId] === 'loading'}
        />
      ) : null}
    </div>
  );
}

function AssistantDocument({
  runId,
  entries,
  active,
  now,
  label = 'Research Desk',
  fallbackText,
  replayAvailable = true,
  replayLoading = false,
}: {
  readonly runId: string;
  readonly entries: TimelineState;
  readonly active: boolean;
  readonly now: string;
  readonly label?: string;
  readonly fallbackText?: string | null;
  readonly replayAvailable?: boolean;
  readonly replayLoading?: boolean;
}) {
  const runEntries = entries.runs[runId]?.entries ?? [];
  const childrenByParent = selectChildEntriesByParent(entries, runId);
  const hasActivity = selectActivityEntries(entries, runId).some(
    (entry) => entry.kind !== 'usage',
  );
  return (
    <article className="message assistant">
      <p className="message-label">{label}</p>
      <div className="assistant-surface">
        {runEntries.map((entry) => {
          if (entry.kind === 'agentText' && entry.origin === 'assistant_text')
            return (
              <AssistantMarkdown key={timelineKey(entry)} text={entry.text} />
            );
          if (!isRenderableActivity(entry)) return null;
          return (
            <ActivityItem
              key={timelineKey(entry)}
              active={active}
              entry={entry}
              children={childrenByParent.get(entry.activityId.value) ?? []}
            />
          );
        })}
        {!hasRenderableDocumentEntries(entries, runId) && fallbackText ? (
          <AssistantMarkdown text={fallbackText} />
        ) : null}
      </div>
      <ReplayStatusNotice
        active={active}
        hasActivity={hasActivity}
        replayAvailable={replayAvailable}
        replayLoading={replayLoading}
      />
      <TurnFooter entries={entries} runId={runId} now={now} />
    </article>
  );
}

function ReplayStatusNotice({
  active,
  hasActivity,
  replayAvailable,
  replayLoading,
}: {
  readonly active: boolean;
  readonly hasActivity: boolean;
  readonly replayAvailable: boolean;
  readonly replayLoading: boolean;
}) {
  if (replayLoading && !hasActivity)
    return (
      <p className="activity-unavailable">
        {active ? 'Waiting for runtime activity…' : 'Loading saved activity…'}
      </p>
    );
  if (!replayAvailable)
    return (
      <p className="activity-unavailable">
        Activity details are not available for this turn.
      </p>
    );
  return null;
}

function hasRenderableDocumentEntries(entries: TimelineState, runId: string) {
  return (entries.runs[runId]?.entries ?? []).some(
    (entry) =>
      (entry.kind === 'agentText' && entry.origin === 'assistant_text') ||
      isRenderableActivity(entry),
  );
}

function TurnFooter({
  entries,
  runId,
  now,
}: {
  readonly entries: TimelineState;
  readonly runId: string;
  readonly now: string;
}) {
  const lifecycle = selectCurrentLifecycle(entries, runId);
  const usage = selectUsageEntry(entries, runId)?.usage;
  const updatedAt = latestCreatedAt(entries, runId);
  const details = [
    lifecycle ? lifecycle.status : null,
    usage ? formatUsage(usage) : null,
    relativeTime(updatedAt, now),
  ].filter(Boolean);
  return details.length ? (
    <p className="message-meta">{details.join(' · ')}</p>
  ) : null;
}

function latestCreatedAt(entries: TimelineState, runId: string) {
  let latest: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const entry of entries.runs[runId]?.entries ?? []) {
    if (!entry.lastCreatedAt) continue;
    const timestamp = Date.parse(entry.lastCreatedAt);
    if (Number.isFinite(timestamp) && timestamp > latestMs) {
      latest = entry.lastCreatedAt;
      latestMs = timestamp;
    }
  }
  return latest;
}

function formatUsage(
  usage: NonNullable<ReturnType<typeof selectUsageEntry>>['usage'],
) {
  const values = [
    usage.inputTokens === undefined
      ? null
      : `${usage.inputTokens.toLocaleString()} input`,
    usage.outputTokens === undefined
      ? null
      : `${usage.outputTokens.toLocaleString()} output`,
    usage.totalCostUsd === undefined
      ? null
      : `$${usage.totalCostUsd.toFixed(4)}`,
  ].filter(Boolean);
  return values.length ? values.join(', ') : 'Usage reported';
}

function relativeTime(value: string | null, now: string) {
  if (!value) return null;
  const then = Date.parse(value);
  const current = Date.parse(now);
  if (!Number.isFinite(then) || !Number.isFinite(current)) return null;
  const seconds = Math.max(0, Math.floor((current - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function isRenderableActivity(
  entry: TimelineEntry,
): entry is TimelineActivityEntry {
  return (
    (entry.kind === 'thinking' && entry.origin === 'reasoning_progress') ||
    (entry.kind === 'tool' &&
      entry.origin === 'tool_status' &&
      entry.parentActivityId === undefined) ||
    entry.kind === 'approval'
  );
}

function timelineKey(entry: TimelineEntry) {
  return `${entry.runId}-${entry.activityId.scope}-${entry.activityId.value}`;
}

function TeamTranscript({
  session,
  timeline,
  replayStatus,
  now,
}: {
  readonly session: TeamSessionResponse;
  readonly timeline: TimelineState;
  readonly replayStatus: Readonly<Record<string, ReplayStatus>>;
  readonly now: string;
}) {
  if (session.turns.length === 0)
    return (
      <div className="team-empty-state">
        <p>No turns have been recorded for this Agent Session yet.</p>
      </div>
    );
  return (
    <div className="team-transcript">
      {session.turns.map((turn) => (
        <TeamTurnView
          key={`${turn.task_id}-${turn.sequence}`}
          session={session}
          turn={turn}
          timeline={timeline}
          replayStatus={replayStatus}
          now={now}
        />
      ))}
    </div>
  );
}

function TeamTurnView({
  session,
  turn,
  timeline,
  replayStatus,
  now,
}: {
  readonly session: TeamSessionResponse;
  readonly turn: TeamTurn;
  readonly timeline: TimelineState;
  readonly replayStatus: Readonly<Record<string, ReplayStatus>>;
  readonly now: string;
}) {
  const prompts = selectPromptEntries(timeline, turn.run_id);
  const hasDocument = hasRenderableDocumentEntries(timeline, turn.run_id);
  const label = session.role === 'lead' ? 'Lead' : session.name;
  return (
    <div className="team-turn">
      <div className="team-context-block">
        <span>Assignment context</span>
        <p>{prompts[0]?.text ?? turn.assignment_summary}</p>
      </div>
      {hasDocument || turn.result_summary ? (
        <AssistantDocument
          runId={turn.run_id}
          entries={timeline}
          active={turn.status === 'running'}
          now={now}
          label={label}
          fallbackText={turn.result_summary}
          replayAvailable={replayStatus[turn.run_id] !== 'unavailable'}
          replayLoading={replayStatus[turn.run_id] === 'loading'}
        />
      ) : (
        <>
          <ActivityPanel
            timeline={timeline}
            runId={turn.run_id}
            active={turn.status === 'running'}
            replayAvailable={replayStatus[turn.run_id] !== 'unavailable'}
            replayLoading={replayStatus[turn.run_id] === 'loading'}
          />
          <p className="team-result-pending">
            {turn.status === 'running'
              ? 'Working on this assignment…'
              : 'No result recorded.'}
          </p>
        </>
      )}
    </div>
  );
}

function TeamOverview({ project }: { readonly project: TeamProject }) {
  const gates = [
    ['Finish ready', project.gates.finish_ready],
    ['All work accepted', project.gates.all_work_accepted],
    ['No active attempts', project.gates.no_active_attempts],
    ['All members idle', project.gates.all_members_idle],
  ] as const;
  return (
    <section className="team-overview" aria-label="Team Overview">
      <div className="team-overview-heading">
        <div>
          <p className="section-kicker">Team Overview</p>
          <h2>{phaseLabel(project.phase)}</h2>
        </div>
        <span className={`project-status ${project.status}`}>
          {teamProjectStatusLabel(project.status)}
        </span>
      </div>
      <section
        className="team-overview-section"
        aria-labelledby="team-gates-heading"
      >
        <div className="team-section-heading">
          <p className="section-kicker" id="team-gates-heading">
            Gates
          </p>
          <span>
            {project.gates.finish_ready ? 'Ready to finish' : 'Waiting'}
          </span>
        </div>
        <ul className="team-gates-list">
          {gates.map(([label, passed]) => (
            <li key={label} className={passed ? 'is-passed' : 'is-pending'}>
              <span aria-hidden="true">{passed ? '✓' : '○'}</span>
              {label}
              <small>{passed ? 'Passed' : 'Pending'}</small>
            </li>
          ))}
        </ul>
      </section>
      <section
        className="team-overview-section"
        aria-labelledby="work-board-heading"
      >
        <div className="team-section-heading">
          <p className="section-kicker" id="work-board-heading">
            Work Board
          </p>
          <span>{project.work_items.length} items</span>
        </div>
        {project.work_items.length ? (
          <div className="work-board-list">
            {project.work_items.map((item) => (
              <article className="work-board-item" key={item.work_ref}>
                <div className="work-board-title">
                  <span className="work-ref">{item.work_ref}</span>
                  <strong>{item.subject}</strong>
                  <span className={`work-status ${item.status}`}>
                    {item.status.replaceAll('_', ' ')}
                  </span>
                </div>
                <p>
                  {item.assignee_name
                    ? `Assigned to ${item.assignee_name}`
                    : 'Unassigned'}
                  {item.dependency_refs.length
                    ? ` · Depends on ${item.dependency_refs.join(', ')}`
                    : ''}
                </p>
                {item.latest_attempt ? (
                  <p className="work-attempt">
                    Attempt {item.latest_attempt.attempt_no} ·{' '}
                    {item.latest_attempt.status}
                    {item.latest_attempt.feedback_summary
                      ? ` · ${item.latest_attempt.feedback_summary}`
                      : item.latest_attempt.result_summary
                        ? ` · ${item.latest_attempt.result_summary}`
                        : ''}
                  </p>
                ) : (
                  <p className="work-attempt">No attempt recorded.</p>
                )}
              </article>
            ))}
          </div>
        ) : (
          <p className="team-empty-state">
            No work items have been recorded yet.
          </p>
        )}
      </section>
      <section
        className="team-overview-section"
        aria-labelledby="direct-messages-heading"
      >
        <div className="team-section-heading">
          <p className="section-kicker" id="direct-messages-heading">
            Direct Messages
          </p>
          <span>Safe summaries</span>
        </div>
        {project.direct_messages.length ? (
          <ol className="direct-message-list">
            {project.direct_messages.map((message) => (
              <li key={message.sequence}>
                <div>
                  <strong>{message.sender_name}</strong>
                  <span aria-hidden="true">→</span>
                  <strong>{message.recipient_name}</strong>
                  <small>{message.status}</small>
                </div>
                <p>{message.summary}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="team-empty-state">
            No Direct Messages have been recorded yet.
          </p>
        )}
      </section>
      <section
        className="team-overview-section final-report"
        aria-labelledby="final-report-heading"
      >
        <div className="team-section-heading">
          <p className="section-kicker" id="final-report-heading">
            Final Report
          </p>
        </div>
        {project.final_text ? (
          <AssistantMarkdown text={project.final_text} />
        ) : (
          <p className="team-empty-state">
            The final report will appear when the Team completes its review.
          </p>
        )}
      </section>
    </section>
  );
}

function phaseLabel(phase: TeamProject['phase']) {
  return phase === 'planning'
    ? 'Planning'
    : phase === 'working'
      ? 'Work in progress'
      : phase === 'review'
        ? 'Lead review'
        : phase === 'completed'
          ? 'Completed'
          : 'Failed';
}

function teamProjectStatusLabel(value: TeamProject['status']) {
  return value === 'working'
    ? 'Working'
    : value === 'completed'
      ? 'Completed'
      : 'Couldn’t complete';
}

function groupTurns(messages: readonly Message[]): Turn[] {
  const turns: Turn[] = [];
  const byTask = new Map<string, Turn>();
  for (const message of messages) {
    let turn = byTask.get(message.task_id);
    if (!turn) {
      turn = { taskId: message.task_id, runId: message.run_id };
      byTask.set(message.task_id, turn);
      turns.push(turn);
    }
    if (message.run_id) turn.runId = message.run_id;
    if (message.role === 'user') turn.user = message;
    else turn.assistant = message;
  }
  return turns;
}

function PromptView({
  prompt,
  failed = false,
}: {
  readonly prompt: PromptEntry;
  readonly failed?: boolean;
}) {
  return (
    <article className={`message user ${failed ? 'failed' : ''}`}>
      <p className="message-label">You</p>
      <div className="message-surface">
        <p className="plain-message">{prompt.text}</p>
      </div>
    </article>
  );
}

function MessageView({ message }: { readonly message?: Message }) {
  if (!message) return null;
  const failed = message.status === 'failed';
  return (
    <article className={`message ${message.role} ${failed ? 'failed' : ''}`}>
      <p className="message-label">
        {message.role === 'user' ? 'You' : 'Research Desk'}
      </p>
      <div className="message-surface">
        {message.role === 'assistant' ? (
          <AssistantMarkdown text={message.text} />
        ) : (
          <p className="plain-message">{message.text}</p>
        )}
      </div>
      {message.role === 'assistant' && !failed ? (
        <p className="message-meta">Saved response</p>
      ) : null}
    </article>
  );
}

function EmptyState({
  canCompose,
  onPrompt,
}: {
  readonly canCompose: boolean;
  readonly onPrompt: (prompt: string) => void;
}) {
  return (
    <div className="empty-state">
      <div className="empty-orb" aria-hidden="true">
        ✦
      </div>
      <h2>Start with a brief</h2>
      <p>
        Ask the managed Agent to explain, research, compare, or draft something.
      </p>
      <button
        type="button"
        data-capability="canCompose"
        disabled={canCompose !== true}
        onClick={() =>
          onPrompt(
            'Summarize the current project direction and next decisions.',
          )
        }
      >
        Try an example prompt <span>↗</span>
      </button>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="loading-state" role="status">
      <span className="loading-spinner" aria-hidden="true" />
      Loading your conversation…
    </div>
  );
}

function ErrorState({
  message,
  retryText,
  canRetry,
  onRetry,
}: {
  readonly message: string;
  readonly retryText: string;
  readonly canRetry: boolean;
  readonly onRetry: () => void;
}) {
  return (
    <div className="error-state" role="alert">
      <strong>{message}</strong>
      {canRetry === true && retryText ? (
        <button type="button" data-capability="canRetry" onClick={onRetry}>
          Retry sending
        </button>
      ) : null}
    </div>
  );
}

function Composer({
  text,
  setText,
  status,
  pending,
  error,
  onSend,
  onRetry,
  canCompose,
  hasRetry,
}: {
  readonly text: string;
  readonly setText: (value: string) => void;
  readonly status: ViewStatus;
  readonly pending: boolean;
  readonly error?: string;
  readonly onSend: () => void;
  readonly onRetry: () => void;
  readonly canCompose: boolean;
  readonly hasRetry: boolean;
}) {
  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
    >
      <div className="composer-row">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
          placeholder="Ask the managed Agent…"
          disabled={
            canCompose !== true ||
            pending ||
            status === 'loading' ||
            status === 'running'
          }
          aria-label="Message"
          data-capability="canCompose"
          rows={1}
        />
        <button
          type="submit"
          data-capability="canCompose"
          disabled={
            canCompose !== true ||
            pending ||
            !text.trim() ||
            status === 'loading' ||
            status === 'running'
          }
        >
          Send <span aria-hidden="true">↗</span>
        </button>
      </div>
      <div className={`composer-footer ${error ? 'has-error' : ''}`}>
        <span>
          {error ?? 'Markdown supported · Shift + Enter for a new line'}
        </span>
        {hasRetry ? (
          <button
            type="button"
            className="inline-retry"
            data-capability="canRetry"
            onClick={onRetry}
          >
            Retry
          </button>
        ) : null}
      </div>
    </form>
  );
}
