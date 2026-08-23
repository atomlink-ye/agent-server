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
}: {
  readonly trace: NormalizedTrace;
  readonly live?: boolean;
  readonly selectedAttemptId?: string | null;
  readonly onSelectAttempt?: (attemptId: string) => void;
  readonly view?: TraceView;
  readonly onViewChange?: (view: TraceView) => void;
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
        Captured collaboration and MCP dispatch facts
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
      <div className="run-trace__body">
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
        <Inspector
          mode={model.state.inspectorMode}
          model={model.inspector}
          onMode={model.setInspectorMode}
        />
      </div>
      <aside
        className="run-trace__coverage"
        data-testid="trace-coverage-disclosure"
      >
        <strong data-testid="mcp-only-warning">
          MCP-only execution coverage.
        </strong>{' '}
        Timeline execution detail is {humanize(trace.coverage.scope)}; excluded
        execution: {trace.coverage.excludedExecution.map(humanize).join(', ')}.
        Collaboration Work Items, Attempts, assignments, dependencies and
        observed messages are projected from durable control-plane facts.
        {recordedFeedbackCount
          ? ` ${recordedFeedbackCount} recorded feedback edge${recordedFeedbackCount === 1 ? '' : 's'} present.`
          : ''}
      </aside>
      <p className="run-trace__longest-attempt" data-testid="longest-attempt">
        Longest captured attempt:{' '}
        {longestAttemptMs(trace) ?? 'timing not captured'}
        {longestAttemptMs(trace) !== null ? ' ms' : ''}
      </p>
    </section>
  );
}

export type { NormalizedTrace, TraceView };
