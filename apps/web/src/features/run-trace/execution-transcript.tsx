'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ProductExecutionDetailResponse,
  ProductRunTrace,
} from '@atomlink-ye/agent-server/product-contract';

import { AssistantMarkdown } from '@/components/chat/assistant-markdown';
import { ActivityRow } from './activity-row';
import { projectTranscript } from './transcript-projection';
import './execution-transcript.css';

type Trace = Extract<
  ProductRunTrace,
  { projection_status: 'internally_anchored' }
>;
type AttemptEntry = {
  readonly actorName: string;
  readonly workItemId: string;
  readonly workItemSubject: string;
  readonly attemptId: string;
  readonly attemptNo: number;
};

type DetailState =
  | { readonly status: 'idle' | 'loading' }
  | { readonly status: 'ready'; readonly detail: ProductExecutionDetailResponse }
  | { readonly status: 'unavailable'; readonly statusCode?: number };

export function ExecutionTranscript({ live, trace }: { readonly live?: boolean; readonly trace: Trace }) {
  const attempts = useMemo(() => attemptEntries(trace), [trace]);
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null);
  const [detailState, setDetailState] = useState<DetailState>({ status: 'idle' });
  const lastAttemptIdRef = useRef<string | null>(null);
  const selected =
    attempts.find((attempt) => attempt.attemptId === selectedAttemptId) ?? null;

  // Auto-select first attempt when it becomes available
  useEffect(() => {
    if (selectedAttemptId === null && attempts.length > 0) {
      setSelectedAttemptId(attempts[0].attemptId);
    }
  }, [attempts, selectedAttemptId]);

  useEffect(() => {
    if (!selectedAttemptId) {
      setDetailState({ status: 'idle' });
      return;
    }
    let active = true;
    // Only set loading on initial fetch for this attemptId, not on polling updates
    const isNewAttempt = lastAttemptIdRef.current !== selectedAttemptId;
    if (isNewAttempt) {
      lastAttemptIdRef.current = selectedAttemptId;
      setDetailState({ status: 'loading' });
    }
    void fetch(
      `/api/works/${encodeURIComponent(trace.work.id)}/runs/${encodeURIComponent(trace.work_run.id)}/execution-detail?attempt_id=${encodeURIComponent(selectedAttemptId)}`,
      { method: 'GET', cache: 'no-store', headers: { accept: 'application/json' } },
    )
      .then(async (response) => {
        const body = await response.json().catch(() => undefined);
        if (!active) return;
        if (!response.ok || !isExecutionDetail(body)) {
          setDetailState({ status: 'unavailable', statusCode: response.status });
          return;
        }
        setDetailState({ status: 'ready', detail: body });
      })
      .catch(() => {
        if (active) setDetailState({ status: 'unavailable' });
      });
    return () => {
      active = false;
    };
  }, [selectedAttemptId, trace.work.id, trace.work_run.id]);

  // Polling effect: when live=true, refetch every 2-3 seconds without resetting UI state
  useEffect(() => {
    if (!live || !selectedAttemptId || detailState.status === 'idle' || detailState.status === 'loading') return;
    const timer = setInterval(() => {
      void fetch(
        `/api/works/${encodeURIComponent(trace.work.id)}/runs/${encodeURIComponent(trace.work_run.id)}/execution-detail?attempt_id=${encodeURIComponent(selectedAttemptId)}`,
        { method: 'GET', cache: 'no-store', headers: { accept: 'application/json' } },
      )
        .then(async (response) => {
          const body = await response.json().catch(() => undefined);
          if (!response.ok || !isExecutionDetail(body)) {
            setDetailState({ status: 'unavailable', statusCode: response.status });
            return;
          }
          // Update data without resetting selectedAttemptId or state
          setDetailState({ status: 'ready', detail: body });
        })
        .catch(() => {
          // On error, keep existing state
        });
    }, 2500);
    return () => clearInterval(timer);
  }, [live, selectedAttemptId, trace.work.id, trace.work_run.id, detailState.status]);

  if (!attempts.length)
    return (
      <section className="execution-transcript execution-transcript--empty">
        <p className="work-shell-kicker">Agent execution</p>
        <h2>No participant Attempt is available for transcript detail.</h2>
        <p>Single-Agent or uncaptured collaboration identity may not expose Work Item Attempts yet.</p>
      </section>
    );

  return (
    <section className="execution-transcript" data-testid="execution-transcript">
      <div className="execution-transcript__heading">
        <div>
          <p className="work-shell-kicker">Agent execution</p>
          <h2>Open a role and inspect what actually happened</h2>
          <p>
            Full provider output is read through a Product-scoped Attempt detail endpoint. Technical Run,
            TeamRun and RuntimeSession identities stay behind the server boundary.
          </p>
        </div>
        <span>Safe run-event detail</span>
      </div>
      <div className="execution-transcript__body">
        <nav className="execution-transcript__attempts" aria-label="Agent Attempts">
          {attempts.map((attempt) => (
            <button
              aria-pressed={attempt.attemptId === selectedAttemptId}
              key={attempt.attemptId}
              onClick={() => setSelectedAttemptId(attempt.attemptId)}
              type="button"
            >
              <span>{attempt.actorName}</span>
              <strong>{attempt.workItemSubject}</strong>
              <small>Attempt {attempt.attemptNo}</small>
            </button>
          ))}
        </nav>
        <div className="execution-transcript__detail" aria-live="polite">
          {selected ? (
            <header>
              <div>
                <strong>{selected.actorName}</strong>
                <span>{selected.workItemSubject} · Attempt {selected.attemptNo}</span>
              </div>
              <span>{detailState.status === 'ready' ? `${detailState.detail.events.length} events` : ''}</span>
            </header>
          ) : null}
          {detailState.status === 'loading' || detailState.status === 'idle' ? (
            <p className="execution-transcript__notice">Loading captured execution detail…</p>
          ) : null}
          {detailState.status === 'unavailable' ? (
            <p className="execution-transcript__notice">
              Safe execution detail is unavailable for this Attempt. The Run Trace summaries remain the durable fallback.
            </p>
          ) : null}
          {detailState.status === 'ready' ? (
            <ExecutionEvents detail={detailState.detail} trace={trace} selected={selected} />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ExecutionEvents({
  detail,
  trace,
  selected,
}: {
  readonly detail: ProductExecutionDetailResponse;
  readonly trace: Trace;
  readonly selected: AttemptEntry | null;
}) {
  const messages = selected
    ? collaborationMessages(trace, selected.workItemId)
    : [];
  const assistantEvents = detail.events.filter(
    (event) => event.kind === 'assistant_text',
  );
  const activityEntries = projectTranscript(
    detail.events.map((event, index) => ({ ...event, ordinal: index + 1 })),
  ).filter((entry) => entry.event.kind !== 'assistant_text' && entry.event.kind !== 'usage');
  return (
    <div className="execution-transcript__events">
      {messages.length ? (
        <section className="execution-transcript__messages">
          <h3>Agent-to-Agent messages</h3>
          {messages.map((message) => (
            <article key={message.id}>
              <div>
                <strong>{message.sender}</strong>
                <span>→ {message.recipient}</span>
              </div>
              <p>{message.summary}</p>
              <time dateTime={message.createdAt}>{formatTimestamp(message.createdAt)}</time>
            </article>
          ))}
        </section>
      ) : null}
      {assistantEvents.length ? (
        <section className="execution-transcript__answer">
          <h3>Agent output</h3>
          {assistantEvents.map((event, index) =>
            event.kind === 'assistant_text' ? (
              <article key={`${event.sequence}:${index}`}>
                <AssistantMarkdown text={event.text} />
                <time dateTime={event.created_at}>{formatTimestamp(event.created_at)}</time>
              </article>
            ) : null,
          )}
        </section>
      ) : null}
      <section className="execution-transcript__timeline">
        <h3>Execution activity</h3>
        {activityEntries.map((entry) => (
          <ActivityRow key={entry.sourceOrdinals.join(':')} entry={entry} />
        ))}
      </section>
      {!detail.events.length ? (
        <p className="execution-transcript__notice">No safe run events were captured for this Attempt.</p>
      ) : null}
    </div>
  );
}

function attemptEntries(trace: Trace): readonly AttemptEntry[] {
  const actors = new Map(trace.actors.map((actor) => [actor.id, actor.name ?? 'Name not captured']));
  return trace.work_items.flatMap((workItem) =>
    workItem.attempts.map((attempt) => ({
      actorName: workItem.actor_id
        ? actors.get(workItem.actor_id) ?? 'Name not captured'
        : 'Unassigned',
      workItemId: workItem.id,
      workItemSubject: workItem.subject,
      attemptId: attempt.id,
      attemptNo: attempt.attempt_no,
    })),
  );
}

function collaborationMessages(trace: Trace, workItemId: string) {
  const messages = new Map(trace.messages.map((message) => [message.id, message]));
  return trace.edges.flatMap((edge) => {
    if (edge.kind !== 'observed_message' || edge.work_item_id !== workItemId) return [];
    const message = messages.get(edge.message_id);
    return [
      {
        id: edge.message_id,
        sender: message?.sender_name ?? 'Agent',
        recipient: message?.recipient_name ?? 'Agent',
        summary: message?.summary ?? 'Message content was not captured.',
        createdAt: edge.source_created_at,
      },
    ];
  });
}

function isExecutionDetail(value: unknown): value is ProductExecutionDetailResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.capture_scope === 'safe_run_events' && Array.isArray(record.events);
}

function humanize(value: string) { return value.replaceAll('_', ' '); }
function formatTimestamp(value: string) { return `${value.replace('T', ' ').slice(0, 19)} UTC`; }
