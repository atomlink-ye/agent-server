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
