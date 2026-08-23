import type { ReactNode } from 'react';

import {
  captureLabel,
  formatTimestamp,
  humanize,
  recordedTimestamp,
  type InspectorModel,
  type InspectorMode,
} from './selectors';

export function Inspector({
  mode,
  model,
  onMode,
}: {
  readonly mode: InspectorMode;
  readonly model: InspectorModel;
  readonly onMode: (mode: InspectorMode) => void;
}) {
  const selectedAttempt = model.selectedAttempt;
  return (
    <aside
      className="run-trace__inspector"
      aria-live="polite"
      aria-labelledby="trace-inspector-heading"
    >
      <h3 id="trace-inspector-heading">Execution Inspector</h3>
      {selectedAttempt || (mode === 'conversation' && model.messages.length) ? (
        <>
          {selectedAttempt ? (
            <div className="run-trace__selected-execution">
              <h4>{selectedAttempt.workItem.subject}</h4>
              <p>{model.actorName}</p>
            </div>
          ) : null}
          <div
            className="run-trace__inspector-tabs"
            role="tablist"
            aria-label="Inspector detail"
          >
            {(['overview', 'conversation', 'activity'] as const).map((item) => (
              <button
                aria-selected={mode === item}
                key={item}
                onClick={() => onMode(item)}
                role="tab"
                type="button"
              >
                {item[0]!.toUpperCase() + item.slice(1)}
              </button>
            ))}
          </div>
          {mode === 'overview' ? (
            <InspectorOverview
              actorName={model.actorName}
              selectedAttempt={selectedAttempt}
            />
          ) : null}
          {mode === 'conversation' ? (
            <ConversationDetail
              model={model}
              selectedAttempt={selectedAttempt}
            />
          ) : null}
          {mode === 'activity' ? <ActivityDetail model={model} /> : null}
        </>
      ) : (
        <p className="run-trace__unavailable">
          Select an Attempt to inspect recorded facts.
        </p>
      )}
    </aside>
  );
}

function InspectorOverview({
  actorName,
  selectedAttempt,
}: {
  readonly actorName: string;
  readonly selectedAttempt: NonNullable<InspectorModel['selectedAttempt']>;
}) {
  return (
    <>
      <InspectorGroup title="Identity">
        <Fact label="Work Item" value={selectedAttempt.workItem.subject} />
        <Fact label="Agent" value={actorName} />
      </InspectorGroup>
      <InspectorGroup title="Execution facts">
        <Fact label="State" value={humanize(selectedAttempt.attempt.status)} />
        <Fact
          label="Attempt"
          value={`${selectedAttempt.attempt.attemptNo} / ${selectedAttempt.workItem.attempts.length}`}
        />
        <Fact
          label="Started"
          value={recordedTimestamp(selectedAttempt.attempt.startedAt)}
        />
        <Fact
          label="Ended"
          value={recordedTimestamp(selectedAttempt.attempt.endedAt)}
        />
        <Fact
          label="Duration"
          value={
            selectedAttempt.attempt.durationMs === null
              ? 'Not captured'
              : `${(selectedAttempt.attempt.durationMs / 1000).toFixed(1)} seconds`
          }
        />
      </InspectorGroup>
      <InspectorGroup title="Result / feedback">
        <Fact
          label="Result"
          value={
            selectedAttempt.attempt.resultSummary ??
            captureLabel(selectedAttempt.attempt.resultCaptureStatus)
          }
        />
        <Fact
          label="Feedback"
          value={
            selectedAttempt.attempt.feedbackSummary ??
            captureLabel(selectedAttempt.attempt.feedbackCaptureStatus)
          }
        />
      </InspectorGroup>
    </>
  );
}

function ConversationDetail({
  model,
  selectedAttempt,
}: {
  readonly model: InspectorModel;
  readonly selectedAttempt: InspectorModel['selectedAttempt'];
}) {
  return (
    <section
      className="run-trace__transcript"
      data-testid="attempt-conversation"
    >
      <p className="run-trace__detail-disclosure">
        Product Trace currently captures Agent-to-Agent message summaries, not
        the full provider transcript. Full execution text is not inferred from
        technical RuntimeSession or TeamRun APIs.
      </p>
      {model.messages.length ? (
        model.messages.map(({ edge, message }) => (
          <article
            className={
              model.selectedMessageId === edge.messageId
                ? 'run-trace__message--targeted'
                : undefined
            }
            data-message-id={edge.messageId}
            key={edge.messageId}
          >
            <header>
              <strong>{message?.senderName ?? 'Agent'}</strong>
              <span>→ {message?.recipientName ?? 'Agent'}</span>
            </header>
            <p>
              {message?.summary ??
                'Message body not captured in the Product projection.'}
            </p>
            <time dateTime={edge.sourceCreatedAt}>
              {formatTimestamp(edge.sourceCreatedAt)}
            </time>
          </article>
        ))
      ) : (
        <p>
          No Agent-to-Agent message is associated with this Work Item Attempt.
        </p>
      )}
      {selectedAttempt?.attempt.resultSummary ? (
        <article className="run-trace__transcript-result">
          <header>
            <strong>Agent result</strong>
          </header>
          <p>{selectedAttempt.attempt.resultSummary}</p>
        </article>
      ) : null}
    </section>
  );
}

function ActivityDetail({ model }: { readonly model: InspectorModel }) {
  return (
    <section
      className="run-trace__activity-detail"
      data-testid="attempt-activity"
    >
      <p className="run-trace__detail-disclosure">
        MCP dispatch/confirmation is safe structured activity. Direct shell,
        file edit and other non-MCP execution remain outside this trace.
      </p>
      {model.activities.length ? (
        model.activities.map((activity, index) => (
          <article key={`${activity.activityId}:${activity.sequence}:${index}`}>
            <div>
              <strong>{activity.toolName}</strong>
              <span>{humanize(activity.category)}</span>
            </div>
            <span
              className={`run-trace__activity-status run-trace__activity-status--${activity.status}`}
            >
              {humanize(activity.status)}
            </span>
            <p>Result: {captureLabel(activity.resultCaptureStatus)}</p>
          </article>
        ))
      ) : (
        <p>No MCP activity is associated with this Work Item.</p>
      )}
    </section>
  );
}

function InspectorGroup({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="run-trace__inspector-group">
      <h4>{title}</h4>
      <dl>{children}</dl>
    </section>
  );
}

function Fact({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
