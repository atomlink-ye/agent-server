import { t } from '@/i18n';
import type { ReactNode } from 'react';

import {
  captureLabel,
  formatTimestamp,
  humanize,
  recordedTimestamp,
  type InspectorModel,
  type InspectorMode,
} from './selectors';
import { useT } from '../../i18n';

export function Inspector({
  mode,
  model,
  onMode,
}: {
  readonly mode: InspectorMode;
  readonly model: InspectorModel;
  readonly onMode: (mode: InspectorMode) => void;
}) {
  const t = useT();
  const selectedAttempt = model.selectedAttempt;
  if (!selectedAttempt && !(mode === 'conversation' && model.messages.length))
    return null;
  return (
    <aside
      className="run-trace__inspector"
      aria-live="polite"
      aria-labelledby="trace-inspector-heading"
    >
      <h3 id="trace-inspector-heading">{t('trace.inspector')}</h3>
      {selectedAttempt ? (
        <div className="run-trace__selected-execution">
          <h4>{selectedAttempt.workItem.subject}</h4>
          <p>{model.actorName}</p>
        </div>
      ) : null}
      <div
        className="run-trace__inspector-tabs"
        role="tablist"
        aria-label={t('trace.inspectorDetail')}
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
      {mode === 'overview' && selectedAttempt ? (
        <InspectorOverview
          actorName={model.actorName}
          selectedAttempt={selectedAttempt}
        />
      ) : null}
      {mode === 'conversation' ? (
        <ConversationDetail model={model} selectedAttempt={selectedAttempt} />
      ) : null}
      {mode === 'activity' ? <ActivityDetail model={model} /> : null}
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
  const t = useT();
  return (
    <>
      <InspectorGroup title={t('trace.identity')}>
        <Fact
          label={t('trace.workItem')}
          value={selectedAttempt.workItem.subject}
        />
        <Fact label={t('trace.agent')} value={actorName} />
      </InspectorGroup>
      <InspectorGroup title={t('trace.executionFacts')}>
        <Fact
          label={t('trace.state')}
          value={humanize(selectedAttempt.attempt.status)}
        />
        <Fact
          label={t('trace.attempt')}
          value={`${selectedAttempt.attempt.attemptNo} / ${selectedAttempt.workItem.attempts.length}`}
        />
        <Fact
          label={t('trace.started')}
          value={recordedTimestamp(selectedAttempt.attempt.startedAt)}
        />
        <Fact
          label={t('trace.ended')}
          value={recordedTimestamp(selectedAttempt.attempt.endedAt)}
        />
        <Fact
          label={t('trace.duration')}
          value={
            selectedAttempt.attempt.durationMs === null
              ? t('trace.notCaptured')
              : t('trace.seconds', {
                  count: (selectedAttempt.attempt.durationMs / 1000).toFixed(1),
                })
          }
        />
      </InspectorGroup>
      <InspectorGroup title={t('trace.resultFeedback')}>
        <Fact
          label={t('trace.result')}
          value={
            selectedAttempt.attempt.resultSummary ??
            captureLabel(selectedAttempt.attempt.resultCaptureStatus)
          }
        />
        <Fact
          label={t('trace.feedback')}
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
  const t = useT();
  return (
    <section
      className="run-trace__transcript"
      data-testid="attempt-conversation"
    >
      <p className="run-trace__detail-disclosure">
        {t('trace.inspector.messageHint')}
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
              <strong>{message?.senderName ?? t('trace.agent')}</strong>
              <span>→ {message?.recipientName ?? t('trace.agent')}</span>
            </header>
            <p>{message?.summary ?? t('trace.messageBodyMissing')}</p>
            <time dateTime={edge.sourceCreatedAt}>
              {formatTimestamp(edge.sourceCreatedAt)}
            </time>
          </article>
        ))
      ) : (
        <p>{t('trace.inspector.noMessage')}</p>
      )}
      {selectedAttempt?.attempt.resultSummary ? (
        <article className="run-trace__transcript-result">
          <header>
            <strong>{t('trace.agentResult')}</strong>
          </header>
          <p>{selectedAttempt.attempt.resultSummary}</p>
        </article>
      ) : null}
    </section>
  );
}

function ActivityDetail({ model }: { readonly model: InspectorModel }) {
  const t = useT();
  return (
    <section
      className="run-trace__activity-detail"
      data-testid="attempt-activity"
    >
      <p className="run-trace__detail-disclosure">
        {t('trace.inspector.mcpHint')}
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
            <p>
              {t('trace.events.result', {
                result: captureLabel(activity.resultCaptureStatus),
              })}
            </p>
          </article>
        ))
      ) : (
        <p>{t('trace.noMcpActivity')}</p>
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
