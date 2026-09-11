import { useEffect, useState } from 'react';

import type { WorkDetailData } from '../../queries/load-work-detail';
import { AssistantMarkdown } from '@/features/conversations/components/assistant-markdown';
import { loadSessionTranscripts } from '@/features/run-trace/run-trace-gateway';
import { productStatePresentation } from '../work-presentation';
import { latestAssistantSegmentFromSessions } from '../run-outcome';
import { workRunResultFilePath } from '@/app/routes';
import { outcomeBody } from './outcome-headline';
import { useT } from '../../../../i18n';

export function OverviewPane({
  data,
  originConversationId,
}: {
  readonly data: WorkDetailData;
  readonly originConversationId?: string | null;
}) {
  const t = useT();
  if (!data.run)
    return (
      <section className="work-detail-state" data-testid="work-no-runs">
        <p className="work-shell-kicker">{t('work.overview.empty')}</p>
        <h2>{t('work.overview.firstRun')}</h2>
        <p>{t('work.overview.firstRunBody')}</p>
      </section>
    );

  return (
    <OverviewContent
      data={{ ...data, run: data.run }}
      originConversationId={originConversationId}
    />
  );
}

function OverviewContent({
  data,
  originConversationId,
}: {
  readonly data: WorkDetailData & {
    readonly run: NonNullable<WorkDetailData['run']>;
  };
  readonly originConversationId?: string | null;
}) {
  const t = useT();
  const run = data.run;
  const [outcome, setOutcome] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setOutcome(null);
    void loadSessionTranscripts(data.work.id, run.work_run.id)
      .then((transcripts) => {
        if (active)
          setOutcome(latestAssistantSegmentFromSessions(transcripts.sessions));
      })
      .catch(() => {
        if (active) setOutcome(null);
      });
    return () => {
      active = false;
    };
  }, [data.work.id, run.work_run.id]);
  const outcomeDocument = outcome ? outcomeBody(outcome) : '';
  const stateView = productStatePresentation(run.work_run.product_state);
  const live = run.work_run.product_state === 'running';
  // `complete` is the Product projection for an execution whose runs all
  // succeeded. Other terminal states can have summaries, but cannot promise
  // the stable final result file.
  const hasSuccessfulResult = run.work_run.product_state === 'complete';
  return (
    <section className="work-overview" data-testid="work-overview">
      <div className="work-overview__summary">
        <span
          className={`work-state-pill work-state-pill--${run.work_run.product_state}`}
          data-testid="outcome-product-state"
        >
          {stateView.label}
        </span>
        <div data-testid="outcome-summary">
          <p className="work-shell-kicker">{t('work.scope.output')}</p>
          <h2>
            {outcome
              ? t('work.scope.capturedOutput')
              : t('work.scope.outputUnavailable')}
          </h2>
          {outcome ? <p>{t('work.scope.outputSource')}</p> : null}
          <p data-testid="attention-basis">
            {t(`work.scope.state.${run.work_run.product_state}`)}
          </p>
          {outcomeDocument ? (
            <div className="work-overview__outcome" id="run-result">
              <AssistantMarkdown text={outcomeDocument} />
            </div>
          ) : null}
          {live ? (
            <p className="work-live-note">{t('work.scope.outputSnapshot')}</p>
          ) : null}
          {hasSuccessfulResult ? (
            <a
              className="work-result-link"
              href={workRunResultFilePath(
                data.work.id,
                run.work_run.id,
                originConversationId ?? null,
              )}
            >
              {t('work.result.openFile')}
            </a>
          ) : null}
        </div>
      </div>
      <a
        className="work-result-link"
        href={`/observe?${new URLSearchParams({ work: data.work.id, run: run.work_run.id })}`}
      >
        {t('work.scope.observe')}
      </a>
    </section>
  );
}

// Kept as a named export for the focused projector tests and existing callers.
export { latestAssistantSegmentFromSessions as outcomeFromSessions } from '../run-outcome';

export { outcomeBody } from './outcome-headline';
