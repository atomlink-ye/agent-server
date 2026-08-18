'use client';

import { useEffect, useState } from 'react';
import type { ProductRunTrace } from '@atomlink-ye/agent-server/product-contract';

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

type FetchState =
  | { readonly status: 'idle' | 'loading' }
  | { readonly status: 'ready'; readonly data: SessionTranscriptsResponse }
  | { readonly status: 'unavailable' };

export function SessionTranscripts({ trace }: { readonly trace: Trace }) {
  const [state, setState] = useState<FetchState>({ status: 'idle' });
  const [selectedRole, setSelectedRole] = useState<string | null>(null);

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
        if (body.sessions.length && !selectedRole) {
          setSelectedRole(body.sessions[0]!.label.role);
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
  const selected = data.sessions.find((s) => s.label.role === selectedRole) ?? null;

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
          {data.sessions.map((session) => (
            <button
              aria-pressed={session.label.role === selectedRole}
              key={session.label.role}
              onClick={() => setSelectedRole(session.label.role)}
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
                  <SessionEntryBlock key={`${entry.ordinal}:${entry.kind}`} entry={entry} />
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

function SessionEntryBlock({ entry }: { readonly entry: SessionEntry }) {
  if (entry.kind === 'assistant_text') return null;
  if (entry.kind === 'reasoning_progress') {
    const text = (entry as { text?: string | null }).text;
    const status = (entry as { status?: string }).status ?? '';
    return (
      <details className="execution-transcript__event">
        <summary>
          <span>Reasoning</span>
          <strong>{status}</strong>
          <time dateTime={entry.created_at}>{formatTimestamp(entry.created_at)}</time>
        </summary>
        {text ? <p>{text}</p> : <p>Reasoning text was not captured.</p>}
      </details>
    );
  }
  if (entry.kind === 'tool_status') {
    const e = entry as { tool_name?: string | null; label?: string | null; category?: string; status?: string; summary?: string | null; detail_text?: string | null };
    return (
      <details className="execution-transcript__event">
        <summary>
          <span>{e.tool_name ?? e.label ?? humanize(e.category ?? 'tool')}</span>
          <strong>{humanize(e.status ?? 'unknown')}</strong>
          <time dateTime={entry.created_at}>{formatTimestamp(entry.created_at)}</time>
        </summary>
        {e.summary ? <p>{e.summary}</p> : null}
        {e.detail_text ? <pre>{e.detail_text}</pre> : null}
      </details>
    );
  }
  if (entry.kind === 'child_timeline_item') {
    const e = entry as { label?: string; status?: string; summary?: string; detail_text?: string | null };
    return (
      <details className="execution-transcript__event">
        <summary>
          <span>{e.label ?? 'Activity'}</span>
          <strong>{humanize(e.status ?? 'unknown')}</strong>
          <time dateTime={entry.created_at}>{formatTimestamp(entry.created_at)}</time>
        </summary>
        {e.summary ? <p>{e.summary}</p> : null}
        {e.detail_text ? <pre>{e.detail_text}</pre> : null}
      </details>
    );
  }
  if (entry.kind === 'permission') {
    const e = entry as { category?: string; status?: string; decision?: string | null; summary?: string };
    return (
      <div className="execution-transcript__event execution-transcript__event--row">
        <span>Permission · {humanize(e.category ?? 'other')}</span>
        <strong>{e.decision ? humanize(e.decision) : e.status ? humanize(e.status) : 'Not captured / not triggered'}</strong>
        <time dateTime={entry.created_at}>{formatTimestamp(entry.created_at)}</time>
        {e.summary ? <p>{e.summary}</p> : null}
      </div>
    );
  }
  if (entry.kind === 'usage') {
    const e = entry as { input_tokens?: number | null; output_tokens?: number | null; total_cost_usd?: number | null };
    const parts = [
      e.input_tokens == null ? null : `${e.input_tokens.toLocaleString()} input`,
      e.output_tokens == null ? null : `${e.output_tokens.toLocaleString()} output`,
      e.total_cost_usd == null ? null : `$${e.total_cost_usd.toFixed(4)}`,
    ].filter(Boolean);
    return (
      <div className="execution-transcript__event execution-transcript__event--row">
        <span>Usage</span>
        <strong>{parts.length ? parts.join(' · ') : 'Not captured'}</strong>
        <time dateTime={entry.created_at}>{formatTimestamp(entry.created_at)}</time>
      </div>
    );
  }
  if (entry.kind === 'lifecycle') {
    const e = entry as { status?: string };
    return (
      <div className="execution-transcript__event execution-transcript__event--row">
        <span>Lifecycle</span>
        <strong>{humanize(e.status ?? 'unknown')}</strong>
        <time dateTime={entry.created_at}>{formatTimestamp(entry.created_at)}</time>
      </div>
    );
  }
  return (
    <div className="execution-transcript__event execution-transcript__event--row">
      <span>{humanize(entry.kind)}</span>
      <strong>—</strong>
      <time dateTime={entry.created_at}>{formatTimestamp(entry.created_at)}</time>
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
