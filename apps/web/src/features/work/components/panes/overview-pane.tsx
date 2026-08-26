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
  const outcomeDocument = outcome ? outcomeBody(outcome) : '';
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
            {outcome
              ? outcomeHeadline(outcome)
              : resultCaptureLabel(run.work_run.result_capture_status)}
          </h2>
          <p data-testid="attention-basis">{stateView.description}</p>
          {outcomeDocument ? (
            <div className="work-overview__outcome">
              <AssistantMarkdown text={outcomeDocument} />
            </div>
          ) : null}
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

const outcomeHeadlineLimit = 120;

/** The report's own title/first meaningful line, flattened for the heading. */
export function outcomeHeadline(outcome: string): string {
  const flat = (titleLine(outcome)?.text ?? outcome)
    .replace(/[*_`]/g, '')
    .trim();
  return flat.length > outcomeHeadlineLimit
    ? `${flat.slice(0, outcomeHeadlineLimit).trimEnd()}…`
    : flat;
}

/**
 * The report body after the line already promoted to the heading. This applies
 * to both explicit Markdown headings and plain/unheaded outcomes, so a result
 * like `Done` is rendered exactly once.
 */
export function outcomeBody(outcome: string): string {
  const title = titleLine(outcome);
  if (!title) return '';
  const lines = outcome.split('\n');
  lines.splice(0, title.index + 1);
  return lines.join('\n').trimStart();
}

function titleLine(outcome: string): {
  readonly text: string;
  readonly index: number;
  readonly isHeading: boolean;
} | null {
  const lines = outcome.split('\n');
  for (const [index, line] of lines.entries()) {
    const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (heading) return { text: heading[2]!.trim(), index, isHeading: true };
    if (line.trim().length > 0)
      return { text: line.trim(), index, isHeading: false };
  }
  return null;
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
