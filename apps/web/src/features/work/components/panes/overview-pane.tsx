import { useEffect, useState } from 'react';

import {
  loadRunRoleSummaries,
  type AnchoredRun,
  type AnchoredTrace,
  type RoleSummary,
  type WorkDetailData,
} from '../../queries/load-work-detail';
import {
  MapView,
  RunTrace,
  type TraceView,
} from '@/features/run-trace/run-trace';
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
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(
    null,
  );
  const [traceView, setTraceView] = useState<TraceView>('timeline');
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
      <RunTrace
        live={live}
        trace={trace}
        selectedAttemptId={selectedAttemptId}
        onSelectAttempt={setSelectedAttemptId}
        view={traceView}
        onViewChange={setTraceView}
      />
      <RunRoleCards
        trace={trace}
        workId={data.work.id}
        runId={run.work_run.id}
        originConversationId={originConversationId}
      />
      <RunReview
        run={run}
        trace={trace}
        selectedAttemptId={selectedAttemptId}
        onSelectAttempt={setSelectedAttemptId}
        onRequestTimelineView={() => setTraceView('timeline')}
      />
    </section>
  );
}

function RunRoleCards({
  trace: _trace,
  workId,
  runId,
  originConversationId,
}: {
  readonly trace: AnchoredTrace;
  readonly workId: string;
  readonly runId: string;
  readonly originConversationId?: string | null;
}) {
  const [sessions, setSessions] = useState<readonly RoleSummary[] | null>(null);

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
            <span>{session.label.role}</span>
            <span>{session.summary.entry_count} entries</span>
          </button>
        );
      })}
    </div>
  );
}

function scrollTestIdIntoViewAfterRender(
  testId: string,
  fallbackTestId?: string,
) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-testid="${testId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (fallbackTestId) {
        document
          .querySelector(`[data-testid="${fallbackTestId}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
}

function RunReview({
  run,
  trace,
  selectedAttemptId,
  onSelectAttempt,
  onRequestTimelineView,
}: {
  readonly run: AnchoredRun;
  readonly trace: AnchoredTrace;
  readonly selectedAttemptId: string | null;
  readonly onSelectAttempt: (attemptId: string) => void;
  readonly onRequestTimelineView: () => void;
}) {
  const attemptCount = trace.work_items.reduce(
    (sum, item) => sum + item.attempts.length,
    0,
  );
  const feedbackCount = trace.edges.filter(
    (edge) => edge.kind === 'feedback',
  ).length;
  const messageCount = trace.edges.filter(
    (edge) => edge.kind === 'observed_message' && edge.source_created_at,
  ).length;
  const reworkItems = trace.work_items.filter(
    (item) => item.attempts.length > 1,
  );
  const mcpOnlyItems = trace.work_items.filter(
    (item) =>
      trace.mcp_activities.some(
        (a) => a.source_refs.work_item_id === item.id,
      ) &&
      !trace.edges.some(
        (e) => e.kind === 'observed_message' && e.work_item_id === item.id,
      ),
  );
  const keyOutputs = trace.work_items
    .flatMap((item) =>
      item.attempts
        .filter((a) => a.result_summary || a.feedback_summary)
        .map((a) => ({
          subject: item.subject,
          attemptNo: a.attempt_no,
          result: a.result_summary,
          feedback: a.feedback_summary,
        })),
    )
    .slice(0, 5);

  return (
    <section className="work-review" data-testid="run-review">
      <div className="work-section-heading">
        <p className="work-shell-kicker">Review</p>
        <h2>Run result and collaboration summary</h2>
        <p>
          This review uses captured Product facts only. No assistant text or
          file is promoted to an Artifact.
        </p>
      </div>
      <div className="work-review__grid">
        <article className="work-review__result">
          <span>Final result</span>
          <p>
            {run.work_run.result_summary ??
              resultCaptureLabel(run.work_run.result_capture_status)}
          </p>
        </article>
        <dl className="work-review__facts">
          <ReviewFact label="Agents" value={trace.actors.length} />
          <ReviewFact label="Work Items" value={trace.work_items.length} />
          <ReviewFact
            label="Attempts"
            value={attemptCount}
            onClick={() => {
              onRequestTimelineView();
              scrollTestIdIntoViewAfterRender('trace-timeline');
            }}
          />
          <ReviewFact
            label="Rework"
            value={feedbackCount}
            onClick={() => {
              const reworkItem = trace.work_items.find(
                (item) => item.attempts.length > 1,
              );
              if (reworkItem && reworkItem.attempts[0])
                onSelectAttempt(reworkItem.attempts[0].id);
              onRequestTimelineView();
              scrollTestIdIntoViewAfterRender('trace-timeline');
            }}
          />
          <ReviewFact
            label="Agent messages"
            value={messageCount}
            onClick={() => {
              onRequestTimelineView();
              scrollTestIdIntoViewAfterRender(
                'timeline-messages',
                'trace-timeline',
              );
            }}
          />
          <ReviewFact
            label="MCP activities"
            value={trace.mcp_activities.length}
          />
        </dl>
      </div>
      <div className="work-review__map" data-testid="review-mini-map">
        <h3>Run Map</h3>
        <MapView
          selectedAttemptKey={selectedAttemptId}
          trace={trace}
          onSelect={(attemptId) => {
            onSelectAttempt(attemptId);
            onRequestTimelineView();
            scrollTestIdIntoViewAfterRender('trace-timeline');
          }}
        />
      </div>
      <div className="work-review__problems" data-testid="review-problems">
        <h3>Problems & capture gaps</h3>
        <ul>
          {reworkItems.length ? (
            <li>
              <strong>Rework:</strong>{' '}
              {reworkItems.map((item) => item.subject).join(', ')} (
              {reworkItems.length} item{reworkItems.length > 1 ? 's' : ''}{' '}
              required multiple Attempts)
            </li>
          ) : null}
          {mcpOnlyItems.length ? (
            <li>
              <strong>MCP-only coverage:</strong> {mcpOnlyItems.length} Work
              Item{mcpOnlyItems.length > 1 ? 's have' : ' has'} MCP activity but
              no observed Agent messages
            </li>
          ) : null}
          <li>
            <strong>Timeline scope:</strong>{' '}
            {trace.timeline_coverage.scope.replaceAll('_', ' ')}
            {trace.timeline_coverage.excluded_execution.length ? (
              <>
                {' '}
                — excluded:{' '}
                {trace.timeline_coverage.excluded_execution
                  .map((e) => e.replaceAll('_', ' '))
                  .join(', ')}
              </>
            ) : null}
          </li>
          {!reworkItems.length && !mcpOnlyItems.length ? (
            <li>No problems or capture gaps detected in this Run.</li>
          ) : null}
        </ul>
      </div>
      {keyOutputs.length ? (
        <div className="work-review__outputs" data-testid="review-key-outputs">
          <h3>Key Agent outputs</h3>
          {keyOutputs.map((output, index) => (
            <article key={index}>
              <strong>
                {output.subject} (Attempt {output.attemptNo})
              </strong>
              {output.result ? <p>Result: {output.result}</p> : null}
              {output.feedback ? <p>Feedback: {output.feedback}</p> : null}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ReviewFact({
  label,
  value,
  onClick,
}: {
  readonly label: string;
  readonly value: number;
  readonly onClick?: () => void;
}) {
  if (onClick) {
    return (
      <div
        className="work-review__fact--clickable"
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onClick();
        }}
      >
        <dt>{label}</dt>
        <dd>{value}</dd>
      </div>
    );
  }
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
