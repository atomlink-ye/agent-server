import type { CSSProperties } from 'react';

import { actorTone, humanize, type MapModel } from './selectors';
import type { NormalizedTrace } from './normalized';

export function MapView({
  model,
  trace,
  selectedAttemptId,
  onSelect,
  onSelectMessage,
}: {
  readonly model: MapModel;
  readonly trace: NormalizedTrace;
  readonly selectedAttemptId: string | null;
  readonly onSelect: (id: string) => void;
  readonly onSelectMessage: (messageId: string) => void;
}) {
  // The Map draws a dependency DAG over Work Item Attempts, a Team concept.
  // A single-agent Work has none -- rendering an empty board with a
  // "0 Attempt node(s)" counter would look like a capture failure rather
  // than the honest fact that there is no collaboration graph to draw. A
  // Team Run that has not assigned an Attempt yet is the same empty shape,
  // but is not a single Agent, so the copy does not claim that for it.
  if (!model.entries.length)
    return (
      <section
        className="run-trace__map run-trace__map--empty"
        data-testid="trace-map"
        aria-label="Run causal map"
      >
        <p className="work-shell-kicker">Causal map</p>
        <h3>No collaboration graph was recorded for this Work.</h3>
        <p>
          {trace.actors.size === 0
            ? 'The Map plots Work Item Attempts and their relations, a Team concept. This Work ran as a single Agent, so there is no Attempt or dependency graph to show here.'
            : 'The Map plots Work Item Attempts and their relations. No Attempt has been captured yet for this Run.'}
        </p>
      </section>
    );
  return (
    <section
      className="run-trace__map"
      data-testid="trace-map"
      aria-label="Run causal map"
    >
      <div className="run-trace__map-heading">
        <div>
          <strong>Causal map</strong>
          <p>
            Work Item Attempts are nodes. Duration is deliberately not encoded.
          </p>
        </div>
        <span>{model.entries.length} Attempt node(s)</span>
      </div>
      <div className="run-trace__map-board">
        {model.entries.map((entry) => (
          <button
            aria-pressed={selectedAttemptId === entry.attempt.id}
            className={`run-trace__map-node ${actorTone(entry.workItem.actorId ?? entry.workItem.id)}`}
            data-map-level={model.levels.get(entry.workItem.id) ?? 0}
            key={entry.attempt.id}
            onClick={() => onSelect(entry.attempt.id)}
            style={
              {
                '--map-level': model.levels.get(entry.workItem.id) ?? 0,
              } as CSSProperties
            }
            type="button"
          >
            <span className="run-trace__map-node-agent">
              {entry.workItem.actorId
                ? (trace.actors.get(entry.workItem.actorId)?.name ??
                  'Name not captured')
                : 'Name not captured'}
            </span>
            <strong>{entry.workItem.subject}</strong>
            <span>
              Attempt {entry.attempt.attemptNo} ·{' '}
              {humanize(entry.attempt.status)}
            </span>
          </button>
        ))}
      </div>
      <MapRelations model={model} onSelectMessage={onSelectMessage} />
    </section>
  );
}

function MapRelations({
  model,
  onSelectMessage,
}: {
  readonly model: MapModel;
  readonly onSelectMessage: (messageId: string) => void;
}) {
  return (
    <div
      className="run-trace__map-relations"
      aria-label="Captured causal relations"
    >
      <h4>Captured relations</h4>
      {model.relations.length ? (
        model.relations.map((row) =>
          row.messageId ? (
            <button
              className="run-trace__map-relation run-trace__map-relation--clickable"
              key={row.key}
              onClick={() => onSelectMessage(row.messageId!)}
              type="button"
            >
              <span>{row.kind}</span>
              <p>{row.text}</p>
            </button>
          ) : (
            <div className="run-trace__map-relation" key={row.key}>
              <span>{row.kind}</span>
              <p>{row.text}</p>
            </div>
          ),
        )
      ) : (
        <p>No relation rows were captured.</p>
      )}
    </div>
  );
}
