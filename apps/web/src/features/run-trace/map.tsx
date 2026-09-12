import { t } from '@/i18n';
import type { CSSProperties } from 'react';

import { actorTone, humanize, type MapModel } from './selectors';
import type { NormalizedTrace } from './normalized';
import { useT } from '../../i18n';

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
  const t = useT();
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
        aria-label={t('trace.causalMap')}
      >
        <p className="work-shell-kicker">{t('trace.causalMap.title')}</p>
        <h3>{t('trace.causalMap.emptyTitle')}</h3>
        <p>
          {trace.actors.size === 0
            ? t('trace.causalMap.emptySingle')
            : t('trace.causalMap.empty')}
        </p>
      </section>
    );
  return (
    <section
      className="run-trace__map"
      data-testid="trace-map"
      aria-label={t('trace.causalMap')}
    >
      <div className="run-trace__map-heading">
        <div>
          <strong>{t('trace.causalMap.title')}</strong>
          <p>{t('trace.mapHint')}</p>
        </div>
        <span>{t('trace.mapCount', { count: model.entries.length })}</span>
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
                  t('trace.nameNotCaptured'))
                : t('trace.nameNotCaptured')}
            </span>
            <strong>{entry.workItem.subject}</strong>
            <span>
              {t('work.attempt', { number: entry.attempt.attemptNo })} ·{' '}
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
  const t = useT();
  return (
    <div
      className="run-trace__map-relations"
      aria-label={t('trace.causalMap.relations')}
    >
      <h4>{t('trace.causalMap.relations')}</h4>
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
        <p>{t('trace.causalMap.noRelations')}</p>
      )}
    </div>
  );
}
