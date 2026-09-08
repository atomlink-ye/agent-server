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
import './run-trace.css';

const TAB_LABELS: Record<TraceView, string> = {
  timeline: 'Timeline',
  map: 'Map',
  events: 'MCP Activity',
};

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
            <p className="run-trace__eyebrow">Execution record</p>
            <h2 id="run-trace-heading">Everything captured during this Run</h2>
          </div>
          <span className={live ? 'run-trace__live' : 'run-trace__historical'}>
            {live ? 'Updating' : `${trace.events.length} events`}
          </span>
        </header>
        <p className="run-trace__subhead">
          Open a section when you need the underlying record; no provider output
          is inferred from these events.
        </p>
        <details className="run-trace__record-section">
          <summary>Event timeline</summary>
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
          <summary>Collaboration relationships</summary>
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
          <summary>Recorded tool activity ({trace.activities.length})</summary>
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
          <summary>What this record includes</summary>
          <p>
            This record covers {humanize(trace.coverage.scope)}; excluded
            execution:{' '}
            {trace.coverage.excludedExecution.map(humanize).join(', ')}.
            {recordedFeedbackCount
              ? ` ${recordedFeedbackCount} recorded feedback edge${recordedFeedbackCount === 1 ? '' : 's'} present.`
              : ''}
          </p>
        </details>
      </section>
    );
  return (
    <section className="run-trace" aria-labelledby="run-trace-heading">
      <header className="run-trace__header">
        <div>
          <p className="run-trace__eyebrow">Run Trace</p>
          <h2 id="run-trace-heading">{trace.work.title}</h2>
        </div>
        <span className={live ? 'run-trace__live' : 'run-trace__historical'}>
          {live ? 'Live Run Trace' : 'Historical Run Trace'}
        </span>
      </header>
      <p className="run-trace__subhead">
        A chronological record of this Run’s captured activity
        {trace.timeline.startedAt !== null && trace.timeline.endedAt !== null
          ? ` · recorded ${formatTimestamp(new Date(trace.timeline.startedAt).toISOString())} → ${formatTimestamp(new Date(trace.timeline.endedAt).toISOString())}`
          : ''}
      </p>
      <div className="run-trace__tabs" role="tablist" aria-label="Trace views">
        {(['timeline', 'map', 'events'] as const).map((item) => (
          <button
            aria-selected={activeView === item}
            className="run-trace__tab"
            key={item}
            onClick={() => model.setView(item)}
            role="tab"
            type="button"
          >
            {TAB_LABELS[item]}
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
        <summary>About this activity record</summary>
        <p>
          The activity list records event sequence, type, time, and Run only. It
          does not expose output bodies. Read the Transcript for captured Worker
          messages and tool details. Structured collaboration detail covers{' '}
          {humanize(trace.coverage.scope)}; excluded execution:{' '}
          {trace.coverage.excludedExecution.map(humanize).join(', ')}.
          {recordedFeedbackCount
            ? ` ${recordedFeedbackCount} recorded feedback edge${recordedFeedbackCount === 1 ? '' : 's'} present.`
            : ''}
        </p>
      </details>
      <p className="run-trace__longest-attempt" data-testid="longest-attempt">
        Longest captured attempt:{' '}
        {longestAttemptMs(trace) ?? 'timing not captured'}
        {longestAttemptMs(trace) !== null ? ' ms' : ''}
      </p>
    </section>
  );
}

export type { NormalizedTrace, TraceView };
