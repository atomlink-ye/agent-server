import { t } from '@/i18n';
import type { CSSProperties } from 'react';

import {
  durationLabel,
  formatActiveDuration,
  relativeTicks,
  type Geometry,
  type CapturedRange,
  type TimelineSpan,
} from './geometry';
import {
  actorTone,
  interactionsForRow,
  type RowInteractions,
  type TimelineModel,
} from './selectors';
import type { NormalizedTrace, TraceExecutionEvent } from './normalized';
import { formatTimestamp, humanize } from './selectors';
import { ActivityRow } from './activity-row';
import {
  projectTranscript,
  type ProjectedTranscriptEntry,
  type TranscriptEntry,
} from './transcript-projection';

export function Timeline({
  model,
  trace,
  live,
  selectedAttemptId,
  onSelect,
  onSelectMessage,
}: {
  readonly model: TimelineModel;
  readonly trace: NormalizedTrace;
  readonly live: boolean;
  readonly selectedAttemptId: string | null;
  readonly onSelect: (id: string) => void;
  readonly onSelectMessage: (messageId: string) => void;
}) {
  return (
    <div className="run-trace__timeline" data-testid="trace-timeline">
      <ActivityTimeline trace={trace} />
      <p className="run-trace__supporting-label">{t('trace.executionLanes')}</p>
      <TimeAxis range={model.range} />
      <div className="run-trace__lanes">
        {model.actorRows.map((actor) => (
          <div
            className={`run-trace__lane run-trace__actor ${actorTone(actor.key)}`}
            key={actor.key}
          >
            <div className="run-trace__lane-name">
              <span>{actor.name}</span>
              {actor.note ? (
                <small className="run-trace__lane-note">{actor.note}</small>
              ) : null}
              <small>
                {formatActiveDuration(actor.rows.flatMap((row) => row.spans))}
              </small>
            </div>
            <div className="run-trace__actor-rows">
              {actor.rows.map((row) => {
                const interactions = interactionsForRow(trace, row);
                return (
                  <div className="run-trace__item-row" key={row.key}>
                    <div className="run-trace__item-name">
                      {row.subject ? <span>{row.subject}</span> : null}
                      <RowInteractionSummary interactions={interactions} />
                    </div>
                    <div className="run-trace__track">
                      {row.spans.map((span) => (
                        <RunSpan
                          activityCount={interactions.calls}
                          attemptNo={
                            span.attemptId !== null
                              ? (trace.attempts.get(span.attemptId)
                                  ?.attemptNo ?? null)
                              : null
                          }
                          feedbackSource={
                            span.attemptId !== null &&
                            model.feedbackAttemptIds.has(span.attemptId)
                          }
                          geometry={model.geometry.get(span.key)}
                          key={span.key}
                          live={live && span.status === 'running'}
                          selected={
                            selectedAttemptId === (span.attemptId ?? span.key)
                          }
                          span={span}
                          subject={row.subject}
                          onSelect={onSelect}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <TimelineMessages
        range={model.range}
        trace={trace}
        onSelectMessage={onSelectMessage}
      />
    </div>
  );
}

function ActivityTimeline({ trace }: { readonly trace: NormalizedTrace }) {
  const chronological = [...trace.events].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.runId.localeCompare(right.runId) ||
      left.sequence - right.sequence,
  );
  const transcriptEntries = (trace.timelineEvents ?? []).map(
    (event, ordinal): TranscriptEntry => ({
      ...event,
      ordinal: ordinal + 1,
      run_id: event.source_refs.run_id,
    }),
  );
  const projected = projectTranscript(transcriptEntries);
  return (
    <section
      className="run-trace__activity-timeline"
      aria-label={t('trace.runActivity')}
    >
      <header>
        <div>
          <strong>{t('agents.activity')}</strong>
          <p>{t('trace.activityHint')}</p>
        </div>
        <span>
          {t('trace.activityCount', {
            count: projected.length || chronological.length,
          })}
        </span>
      </header>
      {projected.length ? (
        <ol>
          {projected.map((entry) => (
            <TimelineActivityRow
              entry={entry}
              key={entry.sourceOrdinals.join(':')}
              trace={trace}
            />
          ))}
        </ol>
      ) : chronological.length ? (
        <ol>
          {groupActivityEvents(chronological).map((entry) =>
            entry.kind === 'output-group' ? (
              <OutputEventGroup group={entry} trace={trace} key={entry.key} />
            ) : (
              <ActivityEventRow
                event={entry.event}
                trace={trace}
                key={entry.key}
              />
            ),
          )}
        </ol>
      ) : (
        <p className="run-trace__empty-activity">{t('trace.activityEmpty')}</p>
      )}
    </section>
  );
}

function TimelineActivityRow({
  entry,
  trace,
}: {
  readonly entry: ProjectedTranscriptEntry;
  readonly trace: NormalizedTrace;
}) {
  const runId = entry.event.source_refs?.run_id ?? null;
  const sequence = entry.event.sequence;
  const responder = runId ? responderName(trace, runId) : null;
  return (
    <li
      className="run-trace__event-row run-trace__timeline-activity-row"
      data-event-sequence={sequence}
      data-run-id={runId ?? undefined}
      title={
        runId
          ? t('trace.sourceEvent', { id: runId, sequence })
          : t('trace.eventSequence', { sequence })
      }
    >
      <time dateTime={entry.startedAt}>{formatTimestamp(entry.startedAt)}</time>
      <div className="run-trace__timeline-activity-copy">
        <ActivityRow actorName={responder} entry={entry} />
        <small>{t('trace.eventSequence', { sequence })}</small>
      </div>
    </li>
  );
}

function responderName(trace: NormalizedTrace, runId: string): string | null {
  // The trace only has an actor name when the Run's actor_id joins to the
  // captured actor roster. A solo Work has no actor row, so null is the
  // truthful fallback rather than a guessed Agent role.
  const run = trace.runs.find((candidate) => candidate.id === runId);
  if (!run?.actorId) return null;
  return trace.actors.get(run.actorId)?.name ?? null;
}

type ActivityEntry =
  | {
      readonly kind: 'event';
      readonly event: TraceExecutionEvent;
      readonly key: string;
    }
  | {
      readonly kind: 'output-group';
      readonly events: readonly TraceExecutionEvent[];
      readonly key: string;
    };

/**
 * Output updates can be very chatty. Consecutive updates from one captured
 * Run are one response until another event interrupts them. This intentionally
 * uses the event order itself rather than a timing threshold, so an appended
 * update extends the same group without guessing whether the agent paused.
 */
function groupActivityEvents(
  events: readonly TraceExecutionEvent[],
): readonly ActivityEntry[] {
  const grouped: ActivityEntry[] = [];
  for (const event of events) {
    const previous = grouped.at(-1);
    if (
      isOutputEvent(event) &&
      previous?.kind === 'output-group' &&
      previous.events[0]?.runId === event.runId
    ) {
      grouped[grouped.length - 1] = {
        ...previous,
        events: [...previous.events, event],
      };
      continue;
    }
    if (isOutputEvent(event)) {
      grouped.push({
        kind: 'output-group',
        events: [event],
        key: activityEventKey(event),
      });
      continue;
    }
    grouped.push({ kind: 'event', event, key: activityEventKey(event) });
  }
  return grouped;
}

function OutputEventGroup({
  group,
  trace,
}: {
  readonly group: Extract<ActivityEntry, { readonly kind: 'output-group' }>;
  readonly trace: NormalizedTrace;
}) {
  const [first] = group.events;
  if (!first) return null;
  // A lone update should stay as compact as every other activity event. The
  // disclosure earns its extra affordance only once it hides repeated rows.
  if (group.events.length === 1)
    return <ActivityEventRow event={first} trace={trace} />;
  return (
    <li className="run-trace__event-group" data-run-id={first.runId}>
      <details>
        <summary>
          <time dateTime={first.createdAt}>
            {formatTimestamp(first.createdAt)}
          </time>
          <span className="run-trace__event-dot run-trace__event-dot--output" />
          <span className="run-trace__event-group-summary">
            <span aria-hidden="true" className="run-trace__event-group-chevron">
              ▸
            </span>
            <span>
              <strong>
                {responderName(trace, first.runId) ?? t('trace.agentResponded')}
              </strong>
              <small>
                {t('trace.updateCount', {
                  count: group.events.length,
                  sequence: observedDuration(group.events),
                })}
              </small>
            </span>
          </span>
        </summary>
        <ol aria-label={t('trace.outputUpdates')}>
          {group.events.map((event) => (
            <ActivityEventRow
              event={event}
              key={activityEventKey(event)}
              trace={trace}
            />
          ))}
        </ol>
      </details>
    </li>
  );
}

function ActivityEventRow({
  event,
  trace,
}: {
  readonly event: TraceExecutionEvent;
  readonly trace: NormalizedTrace;
}) {
  return (
    <li
      className="run-trace__event-row"
      data-event-sequence={event.sequence}
      data-run-id={event.runId}
      title={t('trace.sourceRun', { id: event.runId })}
    >
      <time dateTime={event.createdAt}>{formatTimestamp(event.createdAt)}</time>
      <span
        className={`run-trace__event-dot run-trace__event-dot--${eventTone(event.type)}`}
      />
      <div>
        <strong>
          {event.type.toLocaleLowerCase() === 'output'
            ? (responderName(trace, event.runId) ?? eventLabel(event.type))
            : eventLabel(event.type)}
        </strong>
        <small title={t('trace.sourceRun', { id: event.runId })}>
          {t('trace.eventSequence', { sequence: event.sequence })}
        </small>
      </div>
    </li>
  );
}

function activityEventKey(event: TraceExecutionEvent): string {
  return `${event.runId}:${event.sequence}:${event.createdAt}`;
}

function isOutputEvent(event: TraceExecutionEvent): boolean {
  return event.type.toLocaleLowerCase() === 'output';
}

function observedDuration(events: readonly TraceExecutionEvent[]): string {
  const first = events[0];
  const last = events.at(-1);
  if (!first || !last) return t('trace.durationMissing');
  const milliseconds = Date.parse(last.createdAt) - Date.parse(first.createdAt);
  if (!Number.isFinite(milliseconds)) return t('trace.durationMissing');
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes
    ? t('trace.observedMinutes', { minutes, seconds: seconds % 60 })
    : t('trace.observedSeconds', { count: seconds });
}

function eventLabel(type: string): string {
  const normalized = type.toLocaleLowerCase();
  if (normalized.includes('output')) return t('trace.outputUpdate');
  if (normalized.includes('start')) return t('trace.sessions.runStarted');
  if (
    normalized.includes('succeed') ||
    normalized.includes('complete') ||
    normalized.includes('finish')
  )
    return t('trace.runFinished');
  if (normalized.includes('fail')) return t('trace.runProblem');
  if (normalized.includes('cancel')) return t('trace.runCancelled');
  return humanize(type);
}

function eventTone(
  type: string,
): 'start' | 'output' | 'finish' | 'problem' | 'other' {
  const normalized = type.toLocaleLowerCase();
  if (normalized.includes('output')) return 'output';
  if (normalized.includes('start')) return 'start';
  if (
    normalized.includes('succeed') ||
    normalized.includes('complete') ||
    normalized.includes('finish')
  )
    return 'finish';
  if (normalized.includes('fail') || normalized.includes('cancel'))
    return 'problem';
  return 'other';
}

const shownToolNames = 3;

/**
 * A bar and a duration said a lane was busy without saying what it did. The
 * captured facts already name every tool the run dispatched, so the row says
 * which ones and how often — that is the interaction, in the place someone
 * looks first. The full list is in the title, and the Inspector holds the
 * detail.
 */
function RowInteractionSummary({
  interactions,
}: {
  readonly interactions: RowInteractions;
}) {
  if (!interactions.calls && !interactions.messages) return null;
  const shown = interactions.tools.slice(0, shownToolNames);
  const remaining = interactions.tools.length - shown.length;
  const toolText = shown
    .map((tool) => (tool.count > 1 ? `${tool.name} ×${tool.count}` : tool.name))
    .join(', ');
  return (
    <small
      className="run-trace__item-interactions"
      title={interactions.tools
        .map((tool) => `${tool.name} ×${tool.count}`)
        .join(', ')}
    >
      {interactions.calls
        ? t('trace.callCount', { count: interactions.calls })
        : ''}
      {interactions.calls && interactions.messages ? ' · ' : ''}
      {interactions.messages
        ? t('trace.messageCount', { count: interactions.messages })
        : ''}
      {toolText ? (
        <span className="run-trace__item-tools">
          {toolText}
          {remaining > 0 ? t('trace.moreCount', { count: remaining }) : ''}
        </span>
      ) : null}
    </small>
  );
}

function TimelineMessages({
  range,
  trace,
  onSelectMessage,
}: {
  readonly range: CapturedRange | null;
  readonly trace: NormalizedTrace;
  readonly onSelectMessage: (messageId: string) => void;
}) {
  if (!range) return null;
  const start = Date.parse(range.startedAt);
  const end = Date.parse(range.endedAt);
  const span = end - start;
  if (!span) return null;
  const messageEdges = trace.edges.filter(
    (edge) => edge.kind === 'observed_message',
  );
  if (!messageEdges.length) return null;
  // The markers are positioned as a percentage of the track, so the row has to
  // start where the track starts. It used to span the full width, which put
  // every handoff 286px to the left of the moment it happened -- the one part of
  // the Timeline that says agents talked to each other, pointing at the wrong
  // time. The gutter now says what the row is, so a lone dot is not a mystery.
  return (
    <div
      className="run-trace__timeline-messages"
      aria-label={t('trace.messageMarkers')}
      data-testid="timeline-messages"
    >
      <div className="run-trace__timeline-messages-name">
        <span>{t('trace.handoffs')}</span>
        <small>{messageEdges.length}</small>
      </div>
      <div className="run-trace__timeline-message-track">
        {messageEdges.map((edge) => {
          if (edge.kind !== 'observed_message') return null;
          const position =
            ((Date.parse(edge.sourceCreatedAt) - start) / span) * 100;
          if (position < 0 || position > 100) return null;
          const canDrawLine =
            edge.senderActorId !== null && edge.recipientActorId !== null;
          return (
            <button
              className={`run-trace__message-marker${canDrawLine ? '' : ' run-trace__message-marker--partial'}`}
              data-testid="timeline-message-marker"
              key={edge.messageId}
              onClick={() => onSelectMessage(edge.messageId)}
              style={{ '--marker-position': `${position}%` } as CSSProperties}
              title={
                trace.messages.get(edge.messageId)?.summary ??
                t('trace.messageSummaryMissing')
              }
              type="button"
            >
              <span className="run-trace__message-marker-label">
                {edge.senderActorId
                  ? (trace.actors.get(edge.senderActorId)?.name ?? '?')
                  : '?'}{' '}
                → {trace.actors.get(edge.recipientActorId)?.name ?? '?'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TimeAxis({ range }: { readonly range: CapturedRange | null }) {
  const ticks = range ? relativeTicks(range.startedAt, range.endedAt) : [];
  return (
    <div className="run-trace__axis" aria-label={t('trace.timeAxis')}>
      {range ? (
        <>
          <span aria-hidden="true" style={{ display: 'none' }}>
            {range.startedAt}
          </span>
          <span aria-hidden="true" style={{ display: 'none' }}>
            {range.endedAt}
          </span>
        </>
      ) : null}
      {ticks.map((tick) => (
        <span
          key={tick.position}
          style={{ '--tick-position': `${tick.position}%` } as CSSProperties}
        >
          {tick.label}
        </span>
      ))}
    </div>
  );
}

function RunSpan({
  activityCount,
  attemptNo,
  feedbackSource,
  geometry,
  live,
  selected,
  onSelect,
  span,
  subject,
}: {
  readonly activityCount: number;
  readonly attemptNo: number | null;
  readonly feedbackSource: boolean;
  readonly geometry: Geometry | undefined;
  readonly live: boolean;
  readonly selected: boolean;
  readonly onSelect: (id: string) => void;
  readonly span: TimelineSpan;
  readonly subject: string | null;
}) {
  // Team shapes still carry an attempt label; a run with no attempt join
  // (a single-agent run, or a lead's own coordination run) is described
  // as a Run instead of inventing an Attempt number for it. The number
  // itself is not on the span (spans are run-shaped) -- it is looked up
  // from trace.attempts by the caller, the same join selectTimelineSpans
  // used to set span.attemptId in the first place.
  const attemptLabel =
    attemptNo !== null ? t('work.attempt', { number: attemptNo }) : null;
  const selectionId = span.attemptId ?? span.key;
  if (!geometry)
    return (
      <button
        aria-label={
          subject && attemptLabel
            ? t('trace.attemptTimingMissing', {
                subject: subject ?? '',
                attempt: attemptLabel ?? '',
              })
            : t('trace.runTimingMissing')
        }
        aria-pressed={selected}
        className="run-trace__attempt-unpositioned"
        onClick={() => onSelect(selectionId)}
        type="button"
      >
        {subject && attemptLabel
          ? t('trace.attemptTimingLabel', { attempt: attemptLabel })
          : t('trace.runTimingLabel')}
      </button>
    );
  return (
    <button
      aria-label={
        subject && attemptLabel
          ? t('trace.attemptDuration', {
              subject: subject ?? '',
              attempt: attemptLabel ?? '',
              duration: durationLabel(span),
            })
          : t('trace.runDuration', { duration: durationLabel(span) })
      }
      aria-pressed={selected}
      className={`run-trace__attempt${live ? ' run-trace__attempt--live' : ''}`}
      data-testid="trace-attempt"
      onClick={() => onSelect(selectionId)}
      style={
        {
          '--attempt-left': `${geometry.left}%`,
          '--attempt-width': `${geometry.width}%`,
        } as CSSProperties
      }
      title={subject ?? t('observe.run')}
      type="button"
    >
      <span className="run-trace__attempt-label">
        {subject && attemptLabel ? attemptLabel : t('observe.run')} ·{' '}
        {durationLabel(span)}
      </span>
      {feedbackSource ? (
        <span
          aria-label={t('trace.feedbackRelation')}
          data-attempt-id={span.attemptId}
        >
          {t('trace.feedbackRecorded')}
        </span>
      ) : null}
      {activityCount > 0 ? (
        <span
          className="run-trace__activity-ticks"
          aria-label={t('trace.mcpCount', { count: activityCount })}
          data-testid="activity-ticks"
        >
          {Array.from({ length: Math.min(activityCount, 12) }, (_, index) => (
            <span
              className="run-trace__activity-tick"
              key={index}
              style={
                {
                  '--tick-offset': `${((index + 1) / (Math.min(activityCount, 12) + 1)) * 100}%`,
                } as CSSProperties
              }
            />
          ))}
        </span>
      ) : null}
    </button>
  );
}
