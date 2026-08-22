'use client';

import { useEffect, useState } from 'react';
import type { ProductRunTrace } from '@atomlink-ye/agent-server/product-contract';

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
  type SessionSummary,
  type SessionTranscriptsResponse,
} from './run-trace-gateway';
import './execution-transcript.css';
import './transcript-stream.css';

type Trace = Extract<
  ProductRunTrace,
  { projection_status: 'internally_anchored' }
>;

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
  // Roles are NOT unique inside a Run: a team can run several 'member'
  // sessions. Selection therefore addresses the session by its position in
  // the response, which is the only identifier the contract guarantees.
  const [selectedIndex, setSelectedIndex] = useState<number | null>(
    initialSelectedIndex ?? null,
  );

  // Extract sessions array for use in effects and render
  const sessions = state.status === 'ready' ? state.data.sessions : [];

  useEffect(() => {
    let active = true;
    // Only set loading on initial fetch, not on polling updates
    if (state.status === 'idle') {
      setState({ status: 'loading' });
    }
    void loadSessionTranscripts(trace.work.id, trace.work_run.id)
      .then((data) => {
        if (!active) return;
        setState({ status: 'ready', data });
        if (data.sessions.length && selectedIndex === null) {
          setSelectedIndex(0);
        }
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
  }, [trace.work.id, trace.work_run.id]);

  // Auto-select first session when it becomes available
  useEffect(() => {
    if (selectedIndex === null && sessions.length > 0) {
      setSelectedIndex(0);
    }
  }, [sessions, selectedIndex]);

  // Polling effect: when live=true, refetch every 2-3 seconds without resetting UI state
  useEffect(() => {
    if (!live || state.status === 'idle' || state.status === 'loading') return;
    const timer = setInterval(() => {
      void loadSessionTranscripts(trace.work.id, trace.work_run.id)
        .then((data) => {
          // Update data without resetting selectedIndex or state
          setState({ status: 'ready', data });
        })
        .catch(() => {
          // On error, keep existing state
        });
    }, 2500);
    return () => clearInterval(timer);
  }, [live, trace.work.id, trace.work_run.id, state.status]);

  if (state.status === 'idle' || state.status === 'loading')
    return (
      <section
        className="execution-transcript"
        data-testid="session-transcripts"
      >
        <div className="execution-transcript__heading">
          <div>
            <p className="work-shell-kicker">Session transcripts</p>
            <h2>Loading per-role session transcripts…</h2>
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
            <h2>
              Per-role session transcripts are not available for this Run.
            </h2>
            <p>{message}</p>
          </div>
        </div>
      </section>
    );
  }

  const { data } = state;
  const selected =
    selectedIndex === null ? null : (data.sessions[selectedIndex] ?? null);

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
                : 'The Run completed but no per-role session data was recorded.'}
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
          {data.sessions.length} role{data.sessions.length > 1 ? 's' : ''}
        </span>
      </div>
      <div className="execution-transcript__body">
        <nav
          className="execution-transcript__attempts"
          aria-label="Sessions"
          data-testid="session-role-nav"
        >
          {data.sessions.map((session, index) => (
            <button
              aria-pressed={index === selectedIndex}
              key={`${index}:${session.label.name}`}
              onClick={() => setSelectedIndex(index)}
              type="button"
            >
              <strong>{session.label.name}</strong>
              <span>{session.label.role}</span>
              <small>
                {humanize(session.label.status)} · {session.summary.entry_count}{' '}
                entries
              </small>
            </button>
          ))}
        </nav>
        <div className="execution-transcript__detail" aria-live="polite">
          {selected ? (
            <>
              <header>
                <div>
                  <strong>{selected.label.name}</strong>
                  <span>
                    Role: {selected.label.role} ·{' '}
                    {humanize(selected.label.status)}
                  </span>
                </div>
                <span>{selected.summary.entry_count} entries</span>
              </header>
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
