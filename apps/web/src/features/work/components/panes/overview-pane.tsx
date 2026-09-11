import { useEffect, useState } from 'react';

import {
  loadRunRoleSummaries,
  type AgentSummary,
  type WorkDetailData,
} from '../../queries/load-work-detail';
import { AssistantMarkdown } from '@/features/conversations/components/assistant-markdown';
import { RunTrace } from '@/features/run-trace/run-trace-view';
import { loadSessionTranscripts } from '@/features/run-trace/run-trace-gateway';
import {
  productStatePresentation,
  resultCaptureLabel,
} from '../work-presentation';
import { latestAssistantSegmentFromSessions } from '../run-outcome';
import { workRunResultFilePath, workTabPath } from '@/app/routes';
import { outcomeBody } from './outcome-headline';
import { humanize } from '../work-presentation';
import { useT } from '../../../../i18n';

export function OverviewPane({
  data,
  originConversationId,
}: {
  readonly data: WorkDetailData;
  readonly originConversationId?: string | null;
}) {
  const t = useT();
  if (!data.run || !data.trace)
    return (
      <section className="work-detail-state" data-testid="work-no-runs">
        <p className="work-shell-kicker">{t('work.overview.empty')}</p>
        <h2>{t('work.overview.firstRun')}</h2>
        <p>{t('work.overview.firstRunBody')}</p>
      </section>
    );

  return (
    <OverviewContent
      data={{ ...data, run: data.run, trace: data.trace }}
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
    readonly trace: NonNullable<WorkDetailData['trace']>;
  };
  readonly originConversationId?: string | null;
}) {
  const t = useT();
  const run = data.run;
  const trace = data.trace;
  const [outcome, setOutcome] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
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
          <p className="work-shell-kicker">{t('work.result')}</p>
          <h2>
            {outcome
              ? t('work.result.completed')
              : resultCaptureLabel(run.work_run.result_capture_status)}
          </h2>
          <p data-testid="attention-basis">{stateView.description}</p>
          {outcomeDocument ? (
            <div className="work-overview__outcome" id="run-result">
              <AssistantMarkdown text={outcomeDocument} />
            </div>
          ) : null}
          {live ? (
            <p className="work-live-note">{t('work.result.updating')}</p>
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
      <RunJourney trace={trace} />
      <RunTrace live={live} presentation="record" trace={trace} />
      <RunRoleCards
        workId={data.work.id}
        workRunId={run.work_run.id}
        originConversationId={originConversationId}
      />
    </section>
  );
}

// Kept as a named export for the focused projector tests and existing callers.
export { latestAssistantSegmentFromSessions as outcomeFromSessions } from '../run-outcome';

function RunJourney({
  trace,
}: {
  readonly trace: NonNullable<WorkDetailData['trace']>;
}) {
  const t = useT();
  if (!trace || trace.workItems.size === 0) return null;
  return (
    <section className="work-journey" aria-labelledby="work-journey-heading">
      <div className="work-section-heading">
        <p className="work-shell-kicker">{t('work.journey.eyebrow')}</p>
        <h2 id="work-journey-heading">{t('work.journey.title')}</h2>
        <p>{t('work.journey.body')}</p>
      </div>
      <ol className="work-journey__steps">
        {[...trace.workItems.values()].map((item) => (
          <li key={item.id}>
            <strong>{item.subject}</strong>
            <ul>
              {item.attempts.map((attempt) => (
                <li key={attempt.id}>
                  <span>
                    {t('work.attempt', { number: attempt.attemptNo })} ·{' '}
                    {humanize(attempt.status)}
                  </span>
                  {attempt.resultSummary ? (
                    <p>{attempt.resultSummary}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}

function RunRoleCards({
  workId,
  workRunId,
  originConversationId,
}: {
  readonly workId: string;
  readonly workRunId: string;
  readonly originConversationId?: string | null;
}) {
  const t = useT();
  const [sessions, setSessions] = useState<readonly AgentSummary[] | null>(
    null,
  );

  useEffect(() => {
    let active = true;
    loadRunRoleSummaries(workId, workRunId)
      .then((next) => {
        if (active) setSessions(next);
      })
      .catch(() => {
        if (active) setSessions([]);
      });
    return () => {
      active = false;
    };
  }, [workId, workRunId]);

  if (!sessions || sessions.length === 0) return null;

  return (
    <div className="work-role-cards" data-testid="run-role-cards">
      {sessions.map((session, index) => {
        const action = session.summary.last_meaningful?.action;
        return (
          <button
            className="work-role-card"
            key={`${session.label.name}-${index}`}
            onClick={() => {
              window.location.assign(
                workTabPath(
                  workId,
                  'transcript',
                  workRunId,
                  originConversationId ?? null,
                  index,
                ),
              );
            }}
            title={action ?? undefined}
            type="button"
          >
            <strong>{session.label.name}</strong>
            {session.label.role !== null ? (
              <span>{session.label.role}</span>
            ) : null}
            <span>
              {t('work.sessionSummary', {
                status: session.label.status,
                count: session.summary.entry_count,
              })}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export { outcomeBody } from './outcome-headline';
