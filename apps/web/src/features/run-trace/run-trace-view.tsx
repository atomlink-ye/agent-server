import { useMemo } from 'react';

import { Events } from './events';
import { Inspector } from './inspector';
import { MapView } from './map';
import { formatTimestamp, humanize, longestAttemptMs } from './selectors';
import type { NormalizedTrace } from './normalized';
import { Timeline } from './timeline';
import {
  useRunTraceViewModel,
  type TraceView,
} from './use-run-trace-view-model';
import { useT } from '../../i18n';
import './run-trace.css';

const TAB_KEYS = {
  timeline: 'trace.timeline',
  map: 'trace.map',
  events: 'trace.mcpActivity',
} as const;

export function RunTrace({
  trace,
  live = false,
  selectedAttemptId,
  onSelectAttempt,
  view,
  onViewChange,
  presentation = 'workspace',
}: {
  readonly trace: NormalizedTrace;
  readonly live?: boolean;
  readonly selectedAttemptId?: string | null;
  readonly onSelectAttempt?: (attemptId: string) => void;
  readonly view?: TraceView;
  readonly onViewChange?: (view: TraceView) => void;
  /** Work detail keeps the evidence in disclosures instead of a second tab bar. */
  readonly presentation?: 'workspace' | 'record';
}) {
  const t = useT();
  const model = useRunTraceViewModel(
    trace,
    view,
    selectedAttemptId,
    onViewChange,
    onSelectAttempt,
  );
  const recordedFeedbackCount = useMemo(
    () => trace.edges.filter((edge) => edge.kind === 'feedback').length,
    [trace],
  );
  const activeView = model.state.view;
  const showInspector =
    model.inspector.selectedAttempt !== null ||
    (model.state.inspectorMode === 'conversation' &&
      model.inspector.messages.length > 0);
  if (presentation === 'record')
    return (
      <section
        className="run-trace run-trace--record"
        id="execution-record"
        aria-labelledby="run-trace-heading"
      >
        <header className="run-trace__header">
          <div>
            <p className="run-trace__eyebrow">{t('trace.record.eyebrow')}</p>
            <h2 id="run-trace-heading">{t('trace.record.title')}</h2>
          </div>
          <span className={live ? 'run-trace__live' : 'run-trace__historical'}>
            {live
              ? t('trace.updating')
              : t('trace.eventCount', { count: trace.events.length })}
          </span>
        </header>
        <p className="run-trace__subhead">{t('trace.recordHint')}</p>
        <details className="run-trace__record-section">
          <summary>{t('trace.eventTimeline')}</summary>
          <div className="run-trace__record-canvas">
            <Timeline
              live={live}
              model={model.timeline}
              selectedAttemptId={model.state.selectedAttemptId}
              trace={trace}
              onSelect={model.selectAttempt}
              onSelectMessage={model.selectMessage}
            />
          </div>
        </details>
        <details className="run-trace__record-section">
          <summary>{t('trace.relationships')}</summary>
          <div className="run-trace__record-canvas">
            <MapView
              model={model.map}
              selectedAttemptId={model.state.selectedAttemptId}
              trace={trace}
              onSelect={model.selectAttempt}
              onSelectMessage={model.selectMessage}
            />
          </div>
        </details>
        <details className="run-trace__record-section">
          <summary>
            {t('trace.toolCount', { count: trace.activities.length })}
          </summary>
          <div className="run-trace__record-canvas">
            <Events
              model={model.events}
              onSelectAttempt={model.selectAttempt}
            />
          </div>
        </details>
        {showInspector ? (
          <div className="run-trace__record-inspector">
            <Inspector
              mode={model.state.inspectorMode}
              model={model.inspector}
              onMode={model.setInspectorMode}
            />
          </div>
        ) : null}
        <details
          className="run-trace__coverage"
          data-testid="trace-coverage-disclosure"
        >
          <summary>{t('trace.includes')}</summary>
          <p>
            {t('trace.coverage', {
              scope: humanize(trace.coverage.scope),
              excluded: trace.coverage.excludedExecution
                .map(humanize)
                .join(', '),
            })}
            {recordedFeedbackCount
              ? ` ${t('trace.feedbackCount', { count: recordedFeedbackCount })}`
              : ''}
          </p>
        </details>
      </section>
    );
  return (
    <section className="run-trace" aria-labelledby="run-trace-heading">
      <header className="run-trace__header">
        <div>
          <p className="run-trace__eyebrow">{t('trace.title')}</p>
          <h2 id="run-trace-heading">{trace.work.title}</h2>
        </div>
        <span className={live ? 'run-trace__live' : 'run-trace__historical'}>
          {live ? t('trace.live') : t('trace.historical')}
        </span>
      </header>
      <p className="run-trace__subhead">
        {t('trace.chronological')}
        {trace.timeline.startedAt !== null && trace.timeline.endedAt !== null
          ? t('trace.recordedRange', {
              start: formatTimestamp(
                new Date(trace.timeline.startedAt).toISOString(),
              ),
              end: formatTimestamp(
                new Date(trace.timeline.endedAt).toISOString(),
              ),
            })
          : ''}
      </p>
      <div
        className="run-trace__tabs"
        role="tablist"
        aria-label={t('trace.views')}
      >
        {(['timeline', 'map', 'events'] as const).map((item) => (
          <button
            aria-selected={activeView === item}
            className="run-trace__tab"
            key={item}
            onClick={() => model.setView(item)}
            role="tab"
            type="button"
          >
            {t(TAB_KEYS[item])}
          </button>
        ))}
      </div>
      <div
        className={`run-trace__body${showInspector ? ' run-trace__body--with-inspector' : ''}`}
      >
        <div className="run-trace__canvas">
          {activeView === 'timeline' ? (
            <Timeline
              live={live}
              model={model.timeline}
              selectedAttemptId={model.state.selectedAttemptId}
              trace={trace}
              onSelect={model.selectAttempt}
              onSelectMessage={model.selectMessage}
            />
          ) : null}
          {activeView === 'map' ? (
            <MapView
              model={model.map}
              selectedAttemptId={model.state.selectedAttemptId}
              trace={trace}
              onSelect={model.selectAttempt}
              onSelectMessage={model.selectMessage}
            />
          ) : null}
          {activeView === 'events' ? (
            <Events
              model={model.events}
              onSelectAttempt={model.selectAttempt}
            />
          ) : null}
        </div>
        {showInspector ? (
          <Inspector
            mode={model.state.inspectorMode}
            model={model.inspector}
            onMode={model.setInspectorMode}
          />
        ) : null}
      </div>
      <details
        className="run-trace__coverage"
        data-testid="trace-coverage-disclosure"
      >
        <summary>{t('trace.aboutActivity')}</summary>
        <p>
          {t('trace.executionScope', {
            scope: humanize(trace.coverage.scope),
            excluded: trace.coverage.excludedExecution.map(humanize).join(', '),
          })}
          {recordedFeedbackCount
            ? ` ${t('trace.feedbackCount', { count: recordedFeedbackCount })}`
            : ''}
        </p>
      </details>
      <p className="run-trace__longest-attempt" data-testid="longest-attempt">
        {t('trace.longestAttempt', {
          duration:
            longestAttemptMs(trace) !== null
              ? `${longestAttemptMs(trace)} ms`
              : t('trace.timingMissing'),
        })}
      </p>
    </section>
  );
}

export type { NormalizedTrace, TraceView };
