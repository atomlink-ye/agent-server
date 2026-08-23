import type { CSSProperties } from 'react';

import {
  durationLabel,
  formatActiveDuration,
  relativeTicks,
  type Geometry,
  type CapturedRange,
} from './geometry';
import {
  actorTone,
  interactionsForWorkItem,
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
              <small>{formatActiveDuration(actor.items)}</small>
            </div>
            <div className="run-trace__actor-rows">
              {actor.items.map((workItem) => {
                const interactions = interactionsForWorkItem(
                  trace,
                  workItem.id,
                );
                return (
                  <div className="run-trace__item-row" key={workItem.id}>
                    <div className="run-trace__item-name">
                      <span>{workItem.subject}</span>
                      {interactions.messages || interactions.activities ? (
                        <small>
                          {interactions.messages
                            ? `${interactions.messages} msg`
                            : ''}
                          {interactions.messages && interactions.activities
                            ? ' · '
                            : ''}
                          {interactions.activities
                            ? `${interactions.activities} MCP`
                            : ''}
                        </small>
                      ) : null}
                    </div>
                    <div className="run-trace__track">
                      {workItem.attempts.map((attempt) => (
                        <AttemptSpan
                          activityCount={interactions.activities}
                          attempt={attempt}
                          feedbackSource={model.feedbackAttemptIds.has(
                            attempt.id,
                          )}
                          geometry={model.geometry.get(attempt.id)}
                          key={attempt.id}
                          live={live && attempt.status === 'running'}
                          selected={selectedAttemptId === attempt.id}
                          subject={workItem.subject}
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
  return (
    <div
      className="run-trace__timeline-messages"
      aria-label="Message markers"
      data-testid="timeline-messages"
    >
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

function AttemptSpan({
  activityCount,
  attempt,
  feedbackSource,
  geometry,
  live,
  selected,
  onSelect,
  subject,
}: {
  readonly activityCount: number;
  readonly attempt: TimelineModel['attempts'][number]['attempt'];
  readonly feedbackSource: boolean;
  readonly geometry: Geometry | undefined;
  readonly live: boolean;
  readonly selected: boolean;
  readonly onSelect: (id: string) => void;
  readonly subject: string;
}) {
  if (!geometry)
    return (
      <button
        aria-label={`${subject}, Attempt ${attempt.attemptNo}, timing not captured`}
        aria-pressed={selected}
        className="run-trace__attempt-unpositioned"
        onClick={() => onSelect(attempt.id)}
        type="button"
      >
        Attempt {attempt.attemptNo} · Timing not captured
      </button>
    );
  return (
    <button
      aria-label={`${subject}, Attempt ${attempt.attemptNo}, ${durationLabel(attempt)}`}
      aria-pressed={selected}
      className={`run-trace__attempt${live ? ' run-trace__attempt--live' : ''}`}
      data-testid="trace-attempt"
      onClick={() => onSelect(attempt.id)}
      style={
        {
          '--attempt-left': `${geometry.left}%`,
          '--attempt-width': `${geometry.width}%`,
        } as CSSProperties
      }
      title={subject}
      type="button"
    >
      <span className="run-trace__attempt-label">
        Attempt {attempt.attemptNo} · {durationLabel(attempt)}
      </span>
      {feedbackSource ? (
        <span
          aria-label="Recorded feedback relation"
          data-attempt-id={attempt.id}
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
