import { useEffect, useState } from 'react';

import {
  loadRunRoleSummaries,
  type AgentSummary,
  type WorkDetailData,
} from '../../queries/load-work-detail';
import { AssistantMarkdown } from '@/features/conversations/components/assistant-markdown';
import { RunTrace } from '@/features/run-trace/run-trace-view';
import {
  productStatePresentation,
  resultCaptureLabel,
} from '../work-presentation';
import { workRunResultFilePath, workTabPath } from '@/app/routes';
import { outcomeBody } from './outcome-headline';
import { humanize } from '../work-presentation';

export function OverviewPane({
  data,
  originConversationId,
}: {
  readonly data: WorkDetailData;
  readonly originConversationId?: string | null;
}) {
  if (!data.run || !data.trace)
    return (
      <section className="work-detail-state" data-testid="work-no-runs">
        <p className="work-shell-kicker">Overview</p>
        <h2>Your first Run starts here.</h2>
        <p>
          When a Run starts, its outcome, trace, and collaborator activity
          appear here.
        </p>
      </section>
    );

  const run = data.run;
  const trace = data.trace;
  const outcome = run.work_run.result_summary;
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
          <p className="work-shell-kicker">Result</p>
          <h2>
            {outcome
              ? 'What this Run completed'
              : resultCaptureLabel(run.work_run.result_capture_status)}
          </h2>
          <p data-testid="attention-basis">{stateView.description}</p>
          {outcomeDocument ? (
            <div className="work-overview__outcome" id="run-result">
              <AssistantMarkdown text={outcomeDocument} />
            </div>
          ) : null}
          {live ? (
            <p className="work-live-note">Updating while this Run is active.</p>
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
              Open result file
            </a>
          ) : null}
        </div>
      </div>
      <RunJourney trace={trace} />
      <RunTrace live={live} presentation="record" trace={trace} />
      <RunRoleCards
        workId={data.work.id}
        runId={run.work_run.id}
        originConversationId={originConversationId}
      />
    </section>
  );
}

function RunJourney({
  trace,
}: {
  readonly trace: NonNullable<WorkDetailData['trace']>;
}) {
  if (!trace || trace.workItems.size === 0) return null;
  return (
    <section className="work-journey" aria-labelledby="work-journey-heading">
      <div className="work-section-heading">
        <p className="work-shell-kicker">How it went</p>
        <h2 id="work-journey-heading">Key steps</h2>
        <p>Steps are the Work Items and Attempts recorded for this Run.</p>
      </div>
      <ol className="work-journey__steps">
        {[...trace.workItems.values()].map((item) => (
          <li key={item.id}>
            <strong>{item.subject}</strong>
            <ul>
              {item.attempts.map((attempt) => (
                <li key={attempt.id}>
                  <span>
                    Attempt {attempt.attemptNo} · {humanize(attempt.status)}
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
  runId,
  originConversationId,
}: {
  readonly workId: string;
  readonly runId: string;
  readonly originConversationId?: string | null;
}) {
  const [sessions, setSessions] = useState<readonly AgentSummary[] | null>(
    null,
  );

  useEffect(() => {
    let active = true;
    loadRunRoleSummaries(workId, runId)
      .then((next) => {
        if (active) setSessions(next);
      })
      .catch(() => {
        if (active) setSessions([]);
      });
    return () => {
      active = false;
    };
  }, [workId, runId]);

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
                  runId,
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
              Session {session.label.status} · {session.summary.entry_count}{' '}
              entries
            </span>
          </button>
        );
      })}
    </div>
  );
}

export { outcomeBody } from './outcome-headline';
