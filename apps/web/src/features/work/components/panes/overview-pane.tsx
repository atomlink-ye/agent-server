import { useEffect, useState } from 'react';

import {
  loadRunRoleSummaries,
  type AgentSummary,
  type WorkDetailData,
} from '../../queries/load-work-detail';
import { RunTrace } from '@/features/run-trace/run-trace-view';
import {
  productStatePresentation,
  resultCaptureLabel,
} from '../work-presentation';
import { workTabPath } from '@/app/routes';

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
        <h2>No Run has been recorded yet.</h2>
        <p>The Work exists, but there is no execution history to project.</p>
      </section>
    );

  const run = data.run;
  const trace = data.trace;
  const outcome = run.work_run.result_summary;
  const stateView = productStatePresentation(run.work_run.product_state);
  const live = run.work_run.product_state === 'running';
  return (
    <section className="work-overview" data-testid="work-overview">
      <div className="work-overview__summary">
        <span
          className={`work-state-pill work-state-pill--${run.work_run.product_state}`}
          data-testid="outcome-product-state"
        >
          {stateView.label}
        </span>
        <div>
          <p className="work-shell-kicker">Latest recorded outcome</p>
          <h2>
            {outcome ?? resultCaptureLabel(run.work_run.result_capture_status)}
          </h2>
          <p data-testid="attention-basis">{stateView.description}</p>
          {live ? (
            <p className="work-live-note">
              Refreshing captured Product facts while this Run is active.
            </p>
          ) : null}
        </div>
      </div>
      <RunTrace live={live} trace={trace} />
      <RunRoleCards
        workId={data.work.id}
        runId={run.work_run.id}
        originConversationId={originConversationId}
      />
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
        const title = action ? action : 'No meaningful action captured';
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
            title={title}
            type="button"
          >
            <strong>{session.label.name}</strong>
            {/* Team membership is optional structure -- a lone agent has no
                role, and inventing one ("lead") would assert a product fact
                the domain does not hold. */}
            {session.label.role !== null ? (
              <span>{session.label.role}</span>
            ) : null}
            <span>{session.summary.entry_count} entries</span>
          </button>
        );
      })}
    </div>
  );
}
