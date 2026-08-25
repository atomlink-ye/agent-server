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
import type { NormalizedTrace } from './normalized';

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
        ? `${interactions.calls} ${interactions.calls === 1 ? 'call' : 'calls'}`
        : ''}
      {interactions.calls && interactions.messages ? ' · ' : ''}
      {interactions.messages ? `${interactions.messages} msg` : ''}
      {toolText ? (
        <span className="run-trace__item-tools">
          {toolText}
          {remaining > 0 ? ` +${remaining} more` : ''}
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
      aria-label="Message markers"
      data-testid="timeline-messages"
    >
      <div className="run-trace__timeline-messages-name">
        <span>Handoffs</span>
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
                'Message summary not captured'
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
    <div className="run-trace__axis" aria-label="Recorded time axis">
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
  const attemptLabel = attemptNo !== null ? `Attempt ${attemptNo}` : null;
  const selectionId = span.attemptId ?? span.key;
  if (!geometry)
    return (
      <button
        aria-label={
          subject && attemptLabel
            ? `${subject}, ${attemptLabel}, timing not captured`
            : 'Run, timing not captured'
        }
        aria-pressed={selected}
        className="run-trace__attempt-unpositioned"
        onClick={() => onSelect(selectionId)}
        type="button"
      >
        {subject && attemptLabel
          ? `${attemptLabel} · Timing not captured`
          : 'Run · Timing not captured'}
      </button>
    );
  return (
    <button
      aria-label={
        subject && attemptLabel
          ? `${subject}, ${attemptLabel}, ${durationLabel(span)}`
          : `Run, ${durationLabel(span)}`
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
      title={subject ?? 'Run'}
      type="button"
    >
      <span className="run-trace__attempt-label">
        {subject && attemptLabel ? attemptLabel : 'Run'} · {durationLabel(span)}
      </span>
      {feedbackSource ? (
        <span
          aria-label="Recorded feedback relation"
          data-attempt-id={span.attemptId}
        >
          Feedback recorded
        </span>
      ) : null}
      {activityCount > 0 ? (
        <span
          className="run-trace__activity-ticks"
          aria-label={`${activityCount} MCP activities`}
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
