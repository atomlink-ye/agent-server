import { useState } from 'react';

import { ExecutionTranscript } from '@/features/run-trace/execution-transcript';
import { SessionTranscripts } from '@/features/run-trace/session-transcripts';
import type { WorkDetailData } from '../../queries/load-work-detail';

export function TranscriptPane({
  data,
  selectedSessionIndex,
}: {
  readonly data: WorkDetailData;
  readonly selectedSessionIndex?: number;
}) {
  const [view, setView] = useState<'sessions' | 'execution'>('sessions');
  if (!data.run || !data.trace)
    return (
      <section className="work-detail-state" data-testid="work-no-runs">
        <p className="work-shell-kicker">Transcript</p>
        <h2>No Run has been recorded yet.</h2>
        <p>The Work exists, but there is no execution history to project.</p>
      </section>
    );
  const live = data.run.work_run.product_state === 'running';
  return (
    <section
      className="work-transcript-panel run-trace"
      data-testid="work-transcript-panel"
    >
      <div
        className="run-trace__tabs"
        role="tablist"
        aria-label="Transcript views"
      >
        {(['sessions', 'execution'] as const).map((item) => (
          <button
            aria-selected={view === item}
            className="run-trace__tab"
            key={item}
            onClick={() => setView(item)}
            role="tab"
            type="button"
          >
            {item === 'sessions'
              ? 'Session Transcripts'
              : 'Execution Transcript'}
          </button>
        ))}
      </div>
      {view === 'sessions' ? (
        <SessionTranscripts
          live={live}
          trace={data.trace}
          initialSelectedIndex={selectedSessionIndex}
        />
      ) : (
        <ExecutionTranscript live={live} trace={data.trace} />
      )}
    </section>
  );
}
