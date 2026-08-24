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
      aria-label="Recorded MCP activities"
      data-testid="trace-events"
    >
      <p className="run-trace__events-caption">
        Recorded MCP activities. Sequence values are shown as captured; no
        additional ordering or timing is inferred. This panel counts only calls
        to server-authorized team collaboration MCP tools; other activity is
        shown in Agent Execution and Session Transcripts instead.
      </p>
      <div className="run-trace__events-toolbar">
        <strong>Recorded MCP activities</strong>
        <span>{model.activities.length} captured rows</span>
      </div>
      <div className="run-trace__events-scroll">
        {model.activities.length === 0 ? (
          <p style={{ padding: '1rem', color: 'var(--trace-muted)' }}>
            No collaboration MCP tool calls were captured for this Run.
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
                <span>{entry.actor?.name ?? 'Name not captured'}</span>
                <span>
                  {entry.workItem?.subject ?? 'Work Item not captured'}
                </span>
                <span>MCP activity: {humanize(entry.activity.status)}</span>
                <span>{entry.activity.toolName}</span>
                <span>
                  Result: {captureLabel(entry.activity.resultCaptureStatus)}
                </span>
                {entry.workItem && entry.workItem.attempts.length > 1 ? (
                  <span
                    className="run-trace__event-uncaptured"
                    data-testid="attempt-not-captured"
                  >
                    Attempt attribution not captured
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
