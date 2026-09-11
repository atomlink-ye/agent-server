import { t } from '@/i18n';
import { useState } from 'react';

import { captureLabel, humanize, type EventModel } from './selectors';

export function Events({
  model,
  onSelectAttempt,
}: {
  readonly model: EventModel;
  readonly onSelectAttempt: (id: string) => void;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  return (
    <section
      className="run-trace__events"
      aria-label={t('trace.recordedActivity')}
      data-testid="trace-events"
    >
      <p className="run-trace__events-caption">{t('trace.events.caption')}</p>
      <div className="run-trace__events-toolbar">
        <strong>{t('trace.recordedActivity')}</strong>
        <span>
          {t('trace.events.count', { count: model.activities.length })}
        </span>
      </div>
      <div className="run-trace__events-scroll">
        {model.activities.length === 0 ? (
          <p style={{ padding: '1rem', color: 'var(--trace-muted)' }}>
            {t('trace.events.empty')}
          </p>
        ) : (
          model.activities.map((entry) => {
            const isSelected = selectedKey === entry.key;
            return (
              <button
                aria-pressed={isSelected}
                className="run-trace__event"
                key={entry.key}
                tabIndex={0}
                type="button"
                onClick={() => {
                  setSelectedKey(isSelected ? null : entry.key);
                  // Only select an Attempt when attribution is unambiguous.
                  if (entry.attemptAssociation)
                    onSelectAttempt(entry.attemptAssociation);
                }}
              >
                <strong>#{entry.activity.sequence}</strong>
                <span>{entry.actor?.name ?? t('trace.nameNotCaptured')}</span>
                <span>
                  {entry.workItem?.subject ?? t('trace.events.teamAction')}
                </span>
                <span>
                  {t('trace.events.status', {
                    status: humanize(entry.activity.status),
                  })}
                </span>
                <span>{entry.activity.toolName}</span>
                <span>
                  {t('trace.events.result', {
                    result: captureLabel(entry.activity.resultCaptureStatus),
                  })}
                </span>
                {entry.workItem && entry.workItem.attempts.length > 1 ? (
                  <span
                    className="run-trace__event-uncaptured"
                    data-testid="attempt-not-captured"
                  >
                    {t('trace.events.noAttempt')}
                  </span>
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}
