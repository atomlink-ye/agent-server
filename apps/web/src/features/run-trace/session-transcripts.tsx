import { useEffect, useState } from 'react';

import { AssistantMarkdown } from '@/features/conversations/components/assistant-markdown';
import { ActivityRow } from './activity-row';
import {
  projectTranscript,
  type ProjectedTranscriptEntry,
  type TranscriptEntry,
} from './transcript-projection';
import {
  loadSessionTranscripts,
  RunTraceReadError,
  type SessionEntry,
  type SessionLabel,
  type SessionSummary,
  type SessionTranscriptsResponse,
} from './run-trace-gateway';
import { selectAttemptEntries } from './selectors';
import type { NormalizedTrace, TraceEdge } from './normalized';
import './execution-transcript.css';
import './transcript-stream.css';

type Trace = NormalizedTrace;

// One member per status literal. Collapsing 'idle' | 'loading' into a single
// member breaks discriminated-union narrowing: the negative branch of
// `status === 'idle' || status === 'loading'` still keeps that member, so
// `state` never narrows to the 'ready' member and `state.data` does not exist.
type FetchState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly data: SessionTranscriptsResponse }
  | { readonly status: 'unavailable'; readonly statusCode?: number };

export function SessionTranscripts({
  live,
  trace,
  initialSelectedIndex,
}: {
  readonly live?: boolean;
  readonly trace: Trace;
  readonly initialSelectedIndex?: number;
}) {
  const [state, setState] = useState<FetchState>({ status: 'idle' });
  // Neither name nor role is unique inside a Run: a team can run several
  // 'member' sessions with the same role. Selection addresses the session by
  // its durable identity (source_refs.team_member_run_id, falling back to
  // task_id for the non-Team shape) instead of array position -- a live
  // 2500ms poll can insert a newly-started member ahead of the selected one,
  // and position-based selection would silently jump the user to a
  // different agent when that happens.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // The attempt/work-item filter is a per-agent affordance (R3): it must
  // reset whenever the selected agent changes, or a stale filter from a
  // previous agent would silently narrow the new agent's message context.
  const [selectedWorkItemFilter, setSelectedWorkItemFilter] = useState<
    string | null
  >(null);

  // Extract sessions array for use in effects and render
  const sessions = state.status === 'ready' ? state.data.sessions : [];

  useEffect(() => {
    let active = true;
    // Only set loading on initial fetch, not on polling updates
    if (state.status === 'idle') {
      setState({ status: 'loading' });
    }
    void loadSessionTranscripts(trace.work.id, trace.workRun.id)
      .then((data) => {
        if (active) setState({ status: 'ready', data });
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            status: 'unavailable',
            statusCode:
              error instanceof RunTraceReadError ? error.status : undefined,
          });
        }
      });
    return () => {
      active = false;
    };
  }, [trace.work.id, trace.workRun.id]);

  // Seeds the initial selection once sessions become available, resolving
  // any deep-linked position (e.g. Overview's role cards) into a durable
  // identity. This also covers a Run that starts with zero sessions and
  // gains its first one on a later poll -- it only ever fires while nothing
  // is selected, so it never overrides a user's later choice.
  useEffect(() => {
    if (selectedKey !== null || !sessions.length) return;
    const seeded =
      (initialSelectedIndex !== undefined
        ? sessions[initialSelectedIndex]
        : undefined) ?? sessions[0];
    if (seeded) setSelectedKey(sessionKey(seeded.label));
  }, [sessions, selectedKey, initialSelectedIndex]);

  // A filter chosen for one agent's Work Items is meaningless for another.
  useEffect(() => {
    setSelectedWorkItemFilter(null);
  }, [selectedKey]);

  // Polling effect: when live=true, refetch every 2-3 seconds without resetting UI state
  useEffect(() => {
    if (!live || state.status === 'idle' || state.status === 'loading') return;
    const timer = setInterval(() => {
      void loadSessionTranscripts(trace.work.id, trace.workRun.id)
        .then((data) => {
          // Update data without resetting selectedKey or state
          setState({ status: 'ready', data });
        })
        .catch(() => {
          // On error, keep existing state
        });
    }, 2500);
    return () => clearInterval(timer);
  }, [live, trace.work.id, trace.workRun.id, state.status]);

  if (state.status === 'idle' || state.status === 'loading')
    return (
      <section
        className="execution-transcript"
        data-testid="session-transcripts"
      >
        <div className="execution-transcript__heading">
          <div>
            <p className="work-shell-kicker">Session transcripts</p>
            <h2>Loading session transcripts…</h2>
          </div>
        </div>
      </section>
    );

  if (state.status === 'unavailable') {
    const statusCode = state.statusCode;
    let message = 'Captured session transcripts are not available.';
    if (statusCode === 404) {
      message = 'This Run has not been bound to a provider session yet.';
    } else if (statusCode === 503) {
      message =
        'The service that reads session transcripts is temporarily unavailable. Please try again in a moment.';
    }
    return (
      <section
        className="execution-transcript"
        data-testid="session-transcripts"
      >
        <div className="execution-transcript__heading">
          <div>
            <p className="work-shell-kicker">Session transcripts</p>
            <h2>Session transcripts are not available for this Run.</h2>
            <p>{message}</p>
          </div>
        </div>
      </section>
    );
  }

  const { data } = state;
  const selected =
    selectedKey === null
      ? null
      : (data.sessions.find(
          (session) => sessionKey(session.label) === selectedKey,
        ) ?? null);
  // A Team member's own Work Items -- the join key is the identity a Run
  // and a Work Item already share (see selectors.ts's run-attempt join):
  // source_refs.team_member_run_id IS the actor_id used throughout the
  // trace. A lone-agent session (source_refs.task_id only) never has one,
  // and never has Work Items either, so the filter affordance is simply
  // absent for it -- not an error state.
  const selectedActorId =
    selected?.label.source_refs.team_member_run_id ?? null;
  const agentAttempts = selectedActorId
    ? selectAttemptEntries(trace).filter(
        (entry) => entry.workItem.actorId === selectedActorId,
      )
    : [];
  const filteredWorkItemIds = selectedWorkItemFilter
    ? [selectedWorkItemFilter]
    : [...new Set(agentAttempts.map((entry) => entry.workItem.id))];
  const messages = filteredWorkItemIds
    .flatMap((workItemId) => collaborationMessages(trace, workItemId))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  if (!data.sessions.length)
    return (
      <section
        className="execution-transcript"
        data-testid="session-transcripts"
      >
        <div className="execution-transcript__heading">
          <div>
            <p className="work-shell-kicker">Session transcripts</p>
            <h2>No sessions were captured for this Run.</h2>
            <p>
              {live
                ? 'Session data has not started streaming for this Run yet.'
                : 'The Run completed but no session data was recorded.'}
            </p>
          </div>
        </div>
      </section>
    );

  return (
    <section className="execution-transcript" data-testid="session-transcripts">
      <div className="execution-transcript__heading">
        <div>
          <p className="work-shell-kicker">Session transcripts</p>
          <h2>Session conversation and execution activity</h2>
          <p>
            Each session&apos;s real provider transcript, addressed by session.
            Roles repeat inside one Run. Derived summaries are marked; they are
            not provider original text.
          </p>
        </div>
        <span>
          {data.sessions.length} agent{data.sessions.length > 1 ? 's' : ''}
        </span>
      </div>
      <div className="execution-transcript__body">
        <nav
          className="execution-transcript__attempts"
          aria-label="Sessions"
          data-testid="session-role-nav"
        >
          {data.sessions.map((session) => {
            const key = sessionKey(session.label);
            return (
              <button
                aria-pressed={key === selectedKey}
                key={key}
                onClick={() => setSelectedKey(key)}
                type="button"
              >
                <strong>{session.label.name}</strong>
                {/* Team membership is optional structure -- a lone agent has
                    no role, and inventing one ("lead") would assert a
                    product fact the domain does not hold. */}
                {session.label.role !== null ? (
                  <span>{session.label.role}</span>
                ) : null}
                <small>
                  {humanize(session.label.status)} ·{' '}
                  {session.summary.entry_count} entries
                </small>
              </button>
            );
          })}
        </nav>
        <div className="execution-transcript__detail" aria-live="polite">
          {selected ? (
            <>
              <header>
                <div>
                  <strong>{selected.label.name}</strong>
                  <span>
                    {selected.label.role !== null
                      ? `Role: ${selected.label.role} · `
                      : ''}
                    {humanize(selected.label.status)}
                  </span>
                </div>
                <span>{selected.summary.entry_count} entries</span>
              </header>
              {agentAttempts.length ? (
                <nav
                  className="execution-transcript__work-item-filter"
                  aria-label="Filter by work item"
                  data-testid="session-work-item-filter"
                >
                  <button
                    aria-pressed={selectedWorkItemFilter === null}
                    onClick={() => setSelectedWorkItemFilter(null)}
                    type="button"
                  >
                    All work
                  </button>
                  {agentAttempts.map((entry) => (
                    <button
                      aria-pressed={
                        selectedWorkItemFilter === entry.workItem.id
                      }
                      key={entry.attempt.id}
                      onClick={() =>
                        setSelectedWorkItemFilter(entry.workItem.id)
                      }
                      type="button"
                    >
                      {entry.workItem.subject} · Attempt{' '}
                      {entry.attempt.attemptNo}
                    </button>
                  ))}
                </nav>
              ) : null}
              {messages.length ? (
                <section
                  className="execution-transcript__messages"
                  data-testid="session-messages"
                >
                  <h3>Agent-to-Agent messages</h3>
                  {messages.map((message) => (
                    <article key={message.id}>
                      <div>
                        <strong>{message.sender}</strong>
                        <span>→ {message.recipient}</span>
                      </div>
                      <p>{message.summary}</p>
                      <time dateTime={message.createdAt}>
                        {formatTimestamp(message.createdAt)}
                      </time>
                    </article>
                  ))}
                </section>
              ) : null}
              <SessionSummaryBlock
                summary={selected.summary}
                platformToolCount={
                  selected.entries.filter(
                    (entry) =>
                      entry.kind === 'tool_status' && entry.tool_name !== null,
                  ).length
                }
              />
              <section
                className="execution-transcript__events transcript__events"
                data-testid="session-entries"
              >
                <h3>Session conversation</h3>
                <p className="execution-transcript__notice">
                  Platform tool calls are shown with their real names; their
                  arguments and results are not captured.
                </p>
                {selected.entries.length ? (
                  <TranscriptStream entries={selected.entries} />
                ) : (
                  <p className="execution-transcript__notice">
                    No entries were captured for this session.
                  </p>
                )}
              </section>
              {selected.summary.truncated ? (
                <p
                  className="execution-transcript__notice"
                  data-testid="session-truncated-warning"
                >
                  ⚠️ This transcript is truncated — newer entries exist but were
                  not returned. The captured window shows the earliest{' '}
                  {selected.entries.length} entries.
                </p>
              ) : null}
            </>
          ) : (
            <p className="execution-transcript__notice">
              Select a role to view its session transcript.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function TranscriptStream({
  entries,
}: {
  readonly entries: readonly SessionEntry[];
}) {
  const projected = projectTranscript(entries as readonly TranscriptEntry[]);
  const stream = buildVisibleStream(projected);
  return (
    <div className="transcript__stream" data-testid="transcript-stream">
      {stream.map((item, index) => (
        <div
          className={`transcript__item transcript__item--${item.kind}`}
          data-source-ordinals={item.sourceOrdinals.join(',')}
          key={item.key}
          style={{
            marginTop: index
              ? `${gapAfter(stream[index - 1]!, item)}px`
              : undefined,
          }}
        >
          {item.kind === 'assistant' ? (
            <div className="transcript__prose" data-testid="transcript-prose">
              <AssistantMarkdown text={assistantText(item.entry)} />
            </div>
          ) : null}
          {item.kind === 'activity' ? <ActivityRow entry={item.entry} /> : null}
          {item.kind === 'lifecycle' ? (
            <LifecycleRow entry={item.entry} />
          ) : null}
          {item.kind === 'footer' ? (
            <div className="transcript__footer">{item.text}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

type StreamItem =
  | {
      readonly kind: 'assistant';
      readonly key: string;
      readonly entry: ProjectedTranscriptEntry;
      readonly sourceOrdinals: readonly number[];
    }
  | {
      readonly kind: 'activity';
      readonly key: string;
      readonly entry: ProjectedTranscriptEntry;
      readonly sourceOrdinals: readonly number[];
    }
  | {
      readonly kind: 'lifecycle';
      readonly key: string;
      readonly entry: ProjectedTranscriptEntry;
      readonly sourceOrdinals: readonly number[];
    }
  | {
      readonly kind: 'footer';
      readonly key: string;
      readonly text: string;
      readonly sourceOrdinals: readonly number[];
    };

function buildVisibleStream(
  entries: readonly ProjectedTranscriptEntry[],
): readonly StreamItem[] {
  const stream: StreamItem[] = [];
  let pendingUsage: ProjectedTranscriptEntry[] = [];
  let lastAssistant: ProjectedTranscriptEntry | null = null;
  const flushFooter = () => {
    if (!lastAssistant) return;
    const parts = pendingUsage.flatMap((usage) =>
      usage.event.kind === 'usage' ? usageParts(usage.event) : [],
    );
    stream.push({
      kind: 'footer',
      key: `footer:${lastAssistant.sourceOrdinals.join(':')}`,
      text: parts.length
        ? parts.join(' · ')
        : formatTimestamp(lastAssistant.event.created_at),
      sourceOrdinals: [
        ...lastAssistant.sourceOrdinals,
        ...pendingUsage.flatMap((usage) => usage.sourceOrdinals),
      ],
    });
    lastAssistant = null;
    pendingUsage = [];
  };
  for (const entry of entries) {
    if (entry.event.kind === 'usage') {
      pendingUsage.push(entry);
      continue;
    }
    if (entry.event.kind !== 'assistant_text') flushFooter();
    if (entry.event.kind === 'assistant_text') {
      flushFooter();
      stream.push({
        kind: 'assistant',
        key: entry.sourceOrdinals.join(':'),
        entry,
        sourceOrdinals: entry.sourceOrdinals,
      });
      lastAssistant = entry;
    } else if (entry.event.kind === 'lifecycle') {
      stream.push({
        kind: 'lifecycle',
        key: entry.sourceOrdinals.join(':'),
        entry,
        sourceOrdinals: entry.sourceOrdinals,
      });
    } else {
      stream.push({
        kind: 'activity',
        key: entry.sourceOrdinals.join(':'),
        entry,
        sourceOrdinals: entry.sourceOrdinals,
      });
    }
  }
  flushFooter();
  return stream;
}

function gapAfter(previous: StreamItem, next: StreamItem): number {
  const sequence = (item: StreamItem) => item.kind === 'activity';
  if (sequence(previous) && sequence(next)) return 0;
  if (previous.kind === 'assistant' && next.kind === 'activity') return 4;
  if (previous.kind === 'activity' && next.kind === 'assistant') return 4;
  if (next.kind === 'footer') return 4;
  return 20;
}

function LifecycleRow({ entry }: { readonly entry: ProjectedTranscriptEntry }) {
  const status =
    entry.event.kind === 'lifecycle' ? entry.event.status : 'unknown';
  return status === 'started' ? (
    <div className="transcript__lifecycle-start">Run started</div>
  ) : (
    <div className="transcript__rule">Run {humanize(status)}</div>
  );
}

function usageParts(
  event: Extract<SessionEntry, { readonly kind: 'usage' }>,
): string[] {
  return [
    event.input_tokens === null
      ? null
      : `${event.input_tokens.toLocaleString()} input`,
    event.output_tokens === null
      ? null
      : `${event.output_tokens.toLocaleString()} output`,
    event.total_cost_usd === null
      ? null
      : `$${event.total_cost_usd.toFixed(4)}`,
  ].filter((part): part is string => Boolean(part));
}

function assistantText(entry: ProjectedTranscriptEntry): string {
  return entry.event.kind === 'assistant_text' ? entry.event.text : '';
}

function SessionSummaryBlock({
  summary,
  platformToolCount,
}: {
  readonly summary: SessionSummary;
  readonly platformToolCount: number;
}) {
  return (
    <div
      className="execution-transcript__summary"
      data-testid="session-summary"
    >
      <dl>
        <div>
          <dt>Status</dt>
          <dd>{humanize(summary.status)}</dd>
        </div>
        <div>
          <dt>Entries</dt>
          <dd>{summary.entry_count}</dd>
        </div>
        <div>
          <dt>Last activity</dt>
          <dd>
            {summary.last_timestamp
              ? formatTimestamp(summary.last_timestamp)
              : 'Not captured'}
          </dd>
        </div>
        {summary.work_refs.length ? (
          <div>
            <dt>Work refs</dt>
            <dd>{summary.work_refs.join(', ')}</dd>
          </div>
        ) : null}
        {platformToolCount ? (
          <div data-testid="session-platform-tool-count">
            <dt>Platform tools</dt>
            <dd>{platformToolCount}</dd>
          </div>
        ) : null}
      </dl>
      {summary.last_meaningful ? (
        <aside className="execution-transcript__last-meaningful">
          <strong>
            Last meaningful action (derived summary — not provider text):
          </strong>
          <span>{summary.last_meaningful.kind}</span>
          {summary.last_meaningful.action ? (
            <p>Action: {summary.last_meaningful.action}</p>
          ) : null}
          {summary.last_meaningful.result ? (
            <p>Result: {summary.last_meaningful.result}</p>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}

function humanize(value: string) {
  return value.replaceAll('_', ' ');
}
function formatTimestamp(value: string) {
  return `${value.replace('T', ' ').slice(0, 19)} UTC`;
}

/**
 * A session's durable identity (R4): team_member_run_id for a Team member,
 * task_id for the non-Team "agent_runs" shape. Both are stable across a
 * live poll; array position is not. The name-only fallback only applies to
 * a source_refs shape this contract does not currently produce, kept as a
 * defensive last resort rather than a thrown error.
 */
function sessionKey(label: SessionLabel): string {
  return (
    label.source_refs.team_member_run_id ??
    label.source_refs.task_id ??
    label.name
  );
}

/**
 * Ported from the deleted execution-transcript.tsx rather than dropped: the
 * unified session view still needs Agent-to-Agent message context for a
 * Team member's Work Items, now scoped by the optional attempt/work-item
 * filter instead of by a separate Attempt-nav tab.
 */
function collaborationMessages(trace: NormalizedTrace, workItemId: string) {
  return trace.edges.flatMap((edge: TraceEdge) => {
    if (edge.kind !== 'observed_message' || edge.workItemId !== workItemId)
      return [];
    const message = trace.messages.get(edge.messageId);
    return [
      {
        id: edge.messageId,
        sender: message?.senderName ?? 'Agent',
        recipient: message?.recipientName ?? 'Agent',
        summary: message?.summary ?? 'Message content was not captured.',
        createdAt: edge.sourceCreatedAt,
      },
    ];
  });
}
