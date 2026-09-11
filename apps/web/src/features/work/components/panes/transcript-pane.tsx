import { useState } from 'react';
import { SessionTranscripts } from '@/features/run-trace/session-transcripts';
import type { WorkDetailData } from '../../queries/load-work-detail';
import { workTabHref } from '../work-presentation';
import { useT } from '../../../../i18n';

export function TranscriptPane({
  data,
  selectedSessionIndex,
}: {
  readonly data: WorkDetailData;
  readonly selectedSessionIndex?: number;
}) {
  const t = useT();
  const [refresh, setRefresh] = useState(0);
  if (!data.run || !data.trace)
    return (
      <section className="work-detail-state" data-testid="work-no-runs">
        <p className="work-shell-kicker">{t('work.transcript')}</p>
        <h2>{t('work.transcript.emptyTitle')}</h2>
        <p>{t('work.transcript.emptyBody')}</p>
        <a href={workTabHref(data.work.id, 'runs')}>{t('work.browseRuns')}</a>
      </section>
    );
  const live = data.run.work_run.product_state === 'running';
  // The former Session/Execution sub-tabs projected the identical stream
  // through the identical machinery (projectTranscript + ActivityRow); the
  // only real differences -- grouping by agent vs by attempt, and the
  // Agent-to-Agent message block -- are now inside SessionTranscripts
  // itself (grouped by agent, with the message block scoped by an optional
  // per-agent attempt/work-item filter). There is nothing left to tab
  // between.
  return (
    <section
      className="work-transcript-panel run-trace"
      data-testid="work-transcript-panel"
    >
      <div className="work-status-actions">
        <a href={workTabHref(data.work.id, 'runs')}>{t('work.browseRuns')}</a>
        <button type="button" onClick={() => setRefresh((value) => value + 1)}>
          {t('work.refreshTranscript')}
        </button>
      </div>
      <SessionTranscripts
        key={refresh}
        live={live}
        trace={data.trace}
        initialSelectedIndex={selectedSessionIndex}
        productState={data.run.work_run.product_state}
      />
    </section>
  );
}
