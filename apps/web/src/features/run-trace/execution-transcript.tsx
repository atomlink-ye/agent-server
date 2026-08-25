import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProductExecutionDetailResponse } from '@atomlink-ye/agent-server/product-contract';

import { AssistantMarkdown } from '@/features/conversations/components/assistant-markdown';
import { ActivityRow } from './activity-row';
import { projectTranscript } from './transcript-projection';
import { loadExecutionDetail, RunTraceReadError } from './run-trace-gateway';
import type { NormalizedTrace } from './normalized';
import './execution-transcript.css';

type Trace = NormalizedTrace;
type AttemptEntry = {
  readonly actorName: string;
  readonly workItemId: string;
  readonly workItemSubject: string;
  readonly attemptId: string;
  readonly attemptNo: number;
};

type DetailState =
  | { readonly status: 'idle' | 'loading' }
  | {
      readonly status: 'ready';
      readonly detail: ProductExecutionDetailResponse;
    }
  | { readonly status: 'unavailable'; readonly statusCode?: number };

export function ExecutionTranscript({
  live,
  trace,
}: {
  readonly live?: boolean;
  readonly trace: Trace;
}) {
  const attempts = useMemo(() => attemptEntries(trace), [trace]);
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(
    null,
  );
  const [detailState, setDetailState] = useState<DetailState>({
    status: 'idle',
  });
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
    void loadExecutionDetail(trace.work.id, trace.workRun.id, selectedAttemptId)
      .then((detail) => {
        if (active) setDetailState({ status: 'ready', detail });
      })
      .catch((error: unknown) => {
        if (active) {
          setDetailState({
            status: 'unavailable',
            statusCode:
              error instanceof RunTraceReadError ? error.status : undefined,
          });
        }
      });
    return () => {
      active = false;
    };
  }, [selectedAttemptId, trace.work.id, trace.workRun.id]);

  // Polling effect: when live=true, refetch every 2-3 seconds without resetting UI state
  useEffect(() => {
    if (
      !live ||
      !selectedAttemptId ||
      detailState.status === 'idle' ||
      detailState.status === 'loading'
    )
      return;
    const timer = setInterval(() => {
      void loadExecutionDetail(
        trace.work.id,
        trace.workRun.id,
        selectedAttemptId,
      )
        .then((detail) => {
          // Update data without resetting selectedAttemptId or state
          setDetailState({ status: 'ready', detail });
        })
        .catch(() => {
          // On error, keep existing state
        });
    }, 2500);
    return () => clearInterval(timer);
  }, [
    live,
    selectedAttemptId,
    trace.work.id,
    trace.workRun.id,
    detailState.status,
  ]);

  if (!attempts.length) {
    // The old copy hedged across two different situations with "may not", which
    // left the reader unable to tell a product limit from a capture failure. The
    // trace already distinguishes them: a Work that executed with no Work Items
    // ran as a single Agent, and per-Attempt detail is a Team concept, so there
    // is nothing missing to go looking for.
    const ranWithoutWorkItems = !trace.workItems.size && trace.runs.length > 0;
    return (
      <section className="execution-transcript execution-transcript--empty">
        <p className="work-shell-kicker">Agent execution</p>
        {ranWithoutWorkItems ? (
          <>
            <h2>This Work ran as a single Agent.</h2>
            <p>
              Per-Attempt execution detail is recorded for Team Work, where each
              participant claims a Work Item. A single-Agent Run has no Work
              Items, so there is no Attempt to show here — the Run itself is on
              the Runs tab.
            </p>
          </>
        ) : (
          <>
            <h2>No participant Attempt is available for transcript detail.</h2>
            <p>
              This Run recorded no Work Item Attempts, so collaboration identity
              was either never captured or has not been captured yet.
            </p>
          </>
        )}
      </section>
    );
  }

  return (
    <section
      className="execution-transcript"
      data-testid="execution-transcript"
    >
      <div className="execution-transcript__heading">
        <div>
          <p className="work-shell-kicker">Agent execution</p>
          <h2>Open a role and inspect what actually happened</h2>
          <p>
            Full provider output is read through a Product-scoped Attempt detail
            endpoint. Technical Run, TeamRun and RuntimeSession identities stay
            behind the server boundary.
          </p>
        </div>
        <span>Safe run-event detail</span>
      </div>
      <div className="execution-transcript__body">
        <nav
          className="execution-transcript__attempts"
          aria-label="Agent Attempts"
        >
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
                <span>
                  {selected.workItemSubject} · Attempt {selected.attemptNo}
                </span>
              </div>
              <span>
                {detailState.status === 'ready'
                  ? `${detailState.detail.events.length} events`
                  : ''}
              </span>
            </header>
          ) : null}
          {detailState.status === 'loading' || detailState.status === 'idle' ? (
            <p className="execution-transcript__notice">
              Loading captured execution detail…
            </p>
          ) : null}
          {detailState.status === 'unavailable' ? (
            <p className="execution-transcript__notice">
              Safe execution detail is unavailable for this Attempt. The Run
              Trace summaries remain the durable fallback.
            </p>
          ) : null}
          {detailState.status === 'ready' ? (
            <ExecutionEvents
              detail={detailState.detail}
              trace={trace}
              selected={selected}
            />
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
  ).filter(
    (entry) =>
      entry.event.kind !== 'assistant_text' && entry.event.kind !== 'usage',
  );
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
              <time dateTime={message.createdAt}>
                {formatTimestamp(message.createdAt)}
              </time>
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
                <time dateTime={event.created_at}>
                  {formatTimestamp(event.created_at)}
                </time>
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
        <p className="execution-transcript__notice">
          No safe run events were captured for this Attempt.
        </p>
      ) : null}
    </div>
  );
}

function attemptEntries(trace: Trace): readonly AttemptEntry[] {
  return [...trace.attempts.values()].map((attempt) => {
    const workItem = trace.workItems.get(attempt.workItemId)!;
    return {
      actorName: workItem.actorId
        ? (trace.actors.get(workItem.actorId)?.name ?? 'Name not captured')
        : 'Unassigned',
      workItemId: workItem.id,
      workItemSubject: workItem.subject,
      attemptId: attempt.id,
      attemptNo: attempt.attemptNo,
    };
  });
}

function collaborationMessages(trace: Trace, workItemId: string) {
  return trace.edges.flatMap((edge) => {
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

function humanize(value: string) {
  return value.replaceAll('_', ' ');
}
function formatTimestamp(value: string) {
  return `${value.replace('T', ' ').slice(0, 19)} UTC`;
}
