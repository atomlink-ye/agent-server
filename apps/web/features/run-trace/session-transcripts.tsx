'use client';

import { useEffect, useState } from 'react';
import type { ProductRunTrace } from '@atomlink-ye/agent-server/product-contract';

import { ExecutionEventRenderer } from './execution-event-renderer';
import './execution-transcript.css';

type Trace = Extract<ProductRunTrace, { projection_status: 'internally_anchored' }>;

type SessionLabel = { readonly name: string; readonly role: string; readonly status: string };
type SessionMeaningful = {
  readonly kind: string;
  readonly timestamp: string;
  readonly action: string | null;
  readonly result: string | null;
};
type SessionSummary = {
  readonly status: string;
  readonly entry_count: number;
  readonly last_timestamp: string | null;
  readonly last_meaningful: SessionMeaningful | null;
  readonly work_refs: readonly string[];
  readonly truncated: boolean;
};
type SessionEntry = {
  readonly ordinal: number;
  readonly kind: string;
  readonly sequence: number;
  readonly created_at: string;
  readonly [key: string]: unknown;
};
type Session = {
  readonly label: SessionLabel;
  readonly summary: SessionSummary;
  readonly entries: readonly SessionEntry[];
};
type SessionTranscriptsResponse = {
  readonly work_id: string;
  readonly work_run_id: string;
  readonly capture_scope: string;
  readonly sessions: readonly Session[];
};

// One member per status literal. Collapsing 'idle' | 'loading' into a single
// member breaks discriminated-union narrowing: the negative branch of
// `status === 'idle' || status === 'loading'` still keeps that member, so
// `state` never narrows to the 'ready' member and `state.data` does not exist.
type FetchState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly data: SessionTranscriptsResponse }
  | { readonly status: 'unavailable' };

export function SessionTranscripts({ trace }: { readonly trace: Trace }) {
  const [state, setState] = useState<FetchState>({ status: 'idle' });
  // Roles are NOT unique inside a Run: a team can run several 'member'
  // sessions. Selection therefore addresses the session by its position in
  // the response, which is the only identifier the contract guarantees.
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    void fetch(
      `/api/works/${encodeURIComponent(trace.work.id)}/runs/${encodeURIComponent(trace.work_run.id)}/session-transcripts`,
      { method: 'GET', cache: 'no-store', headers: { accept: 'application/json' } },
    )
      .then(async (response) => {
        const body = await response.json().catch(() => undefined);
        if (!active) return;
        if (!response.ok || !isSessionTranscripts(body)) {
          setState({ status: 'unavailable' });
          return;
        }
        setState({ status: 'ready', data: body });
        if (body.sessions.length) {
          setSelectedIndex(0);
        }
      })
      .catch(() => {
        if (active) setState({ status: 'unavailable' });
      });
    return () => { active = false; };
  }, [trace.work.id, trace.work_run.id]);

  if (state.status === 'idle' || state.status === 'loading')
    return (
      <section className="execution-transcript" data-testid="session-transcripts">
        <div className="execution-transcript__heading">
          <div>
            <p className="work-shell-kicker">Session transcripts</p>
            <h2>Loading per-role session transcripts…</h2>
          </div>
        </div>
      </section>
    );

  if (state.status === 'unavailable')
    return (
      <section className="execution-transcript" data-testid="session-transcripts">
        <div className="execution-transcript__heading">
          <div>
            <p className="work-shell-kicker">Session transcripts</p>
            <h2>Per-role session transcripts are not available for this Run.</h2>
            <p>The endpoint did not return usable data. This may indicate the Run predates per-role capture or the provider session was not instrumented.</p>
          </div>
        </div>
      </section>
    );

  const { data } = state;
  const selected =
    selectedIndex === null ? null : (data.sessions[selectedIndex] ?? null);

  if (!data.sessions.length)
    return (
      <section className="execution-transcript" data-testid="session-transcripts">
        <div className="execution-transcript__heading">
          <div>
            <p className="work-shell-kicker">Session transcripts</p>
            <h2>No sessions were captured for this Run.</h2>
            <p>The Run completed but no per-role session data was recorded.</p>
          </div>
        </div>
      </section>
    );

  return (
    <section className="execution-transcript" data-testid="session-transcripts">
      <div className="execution-transcript__heading">
        <div>
          <p className="work-shell-kicker">Session transcripts</p>
          <h2>Per-role conversation and execution activity</h2>
          <p>
            Each role&apos;s real provider transcript, addressed by role name.
            Derived summaries are marked; they are not provider original text.
          </p>
        </div>
        <span>{data.sessions.length} role{data.sessions.length > 1 ? 's' : ''}</span>
      </div>
      <div className="execution-transcript__body">
        <nav className="execution-transcript__attempts" aria-label="Session roles" data-testid="session-role-nav">
          {data.sessions.map((session, index) => (
            <button
              aria-pressed={index === selectedIndex}
              key={`${index}:${session.label.name}`}
              onClick={() => setSelectedIndex(index)}
              type="button"
            >
              <span>{session.label.name}</span>
              <strong>{session.label.role}</strong>
              <small>{humanize(session.label.status)} · {session.summary.entry_count} entries</small>
            </button>
          ))}
        </nav>
        <div className="execution-transcript__detail" aria-live="polite">
          {selected ? (
            <>
              <header>
                <div>
                  <strong>{selected.label.name}</strong>
                  <span>Role: {selected.label.role} · {humanize(selected.label.status)}</span>
                </div>
                <span>{selected.summary.entry_count} entries</span>
              </header>
              <SessionSummaryBlock summary={selected.summary} />
              <section className="execution-transcript__events" data-testid="session-entries">
                <h3>Session execution activity</h3>
                {selected.entries.length ? selected.entries.map((entry) => (
                  <ExecutionEventRenderer key={`${entry.ordinal}:${entry.kind}`} event={entry} renderAssistantText />
                )) : (
                  <p className="execution-transcript__notice">No entries were captured for this session.</p>
                )}
              </section>
              {selected.summary.truncated ? (
                <p className="execution-transcript__notice" data-testid="session-truncated-warning">
                  ⚠️ This transcript is truncated — older entries exist but were not returned.
                  The captured window shows the most recent {selected.entries.length} entries.
                </p>
              ) : null}
            </>
          ) : (
            <p className="execution-transcript__notice">Select a role to view its session transcript.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function SessionSummaryBlock({ summary }: { readonly summary: SessionSummary }) {
  return (
    <div className="execution-transcript__summary" data-testid="session-summary">
      <dl>
        <div><dt>Status</dt><dd>{humanize(summary.status)}</dd></div>
        <div><dt>Entries</dt><dd>{summary.entry_count}</dd></div>
        <div>
          <dt>Last activity</dt>
          <dd>{summary.last_timestamp ? formatTimestamp(summary.last_timestamp) : 'Not captured'}</dd>
        </div>
        {summary.work_refs.length ? (
          <div><dt>Work refs</dt><dd>{summary.work_refs.join(', ')}</dd></div>
        ) : null}
      </dl>
      {summary.last_meaningful ? (
        <aside className="execution-transcript__last-meaningful">
          <strong>Last meaningful action (derived summary — not provider text):</strong>
          <span>{summary.last_meaningful.kind}</span>
          {summary.last_meaningful.action ? <p>Action: {summary.last_meaningful.action}</p> : null}
          {summary.last_meaningful.result ? <p>Result: {summary.last_meaningful.result}</p> : null}
        </aside>
      ) : null}
    </div>
  );
}

function isSessionTranscripts(value: unknown): value is SessionTranscriptsResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.capture_scope === 'safe_run_events' && Array.isArray(record.sessions);
}

function humanize(value: string) { return value.replaceAll('_', ' '); }
function formatTimestamp(value: string) { return `${value.replace('T', ' ').slice(0, 19)} UTC`; }
