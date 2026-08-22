'use client';

import { useEffect, useState, type ReactNode } from 'react';

import type {
  ProductWorkDefinitionVersionResponse,
  WorkListItem,
} from '@atomlink-ye/agent-server/product-contract';

import { DefinitionPanel } from '@/features/work/components/definition-panel';
import { NewWork } from '@/features/work/components/new-work';
import {
  WORK_TABS,
  formatTimestamp,
  latestRunSummary,
  normalizeWorkTab,
  productStatePresentation,
  resultCaptureLabel,
  workTabHref,
  type WorkTab,
} from '@/features/work/components/work-presentation';
import { ExecutionTranscript } from '@/features/run-trace/execution-transcript';
import { MapView, RunTrace, type TraceView } from '@/features/run-trace/run-trace';
import { SessionTranscripts } from '@/features/run-trace/session-transcripts';
import {
  loadRunRoleSummaries,
  loadWorkDetail,
  loadWorks,
  ProductReadError,
  startWorkRun,
  type AnchoredRun,
  type AnchoredTrace,
  type RoleSummary,
  type WorkDetailData,
} from '@/features/work/work-gateway';
import './work-shell.css';
import './work-shell-overrides.css';

type LoadState = 'loading' | 'available' | 'error' | 'starting';

export function WorkListShell() {
  const [state, setState] = useState<LoadState>('loading');
  const [works, setWorks] = useState<readonly WorkListItem[]>([]);
  const [showNewWork, setShowNewWork] = useState(false);

  useEffect(() => {
    let active = true;
    void loadWorks()
      .then((response) => {
        if (!active) return;
        setWorks(response.works);
        setState('available');
      })
      .catch(() => {
        if (active) setState('error');
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <WorkShellFrame testId="work-list-shell">
      <header className="work-list-header">
        <div>
          <p className="work-shell-kicker">My Work</p>
          <h1>My Work</h1>
          <p className="work-list-header__summary">
            Does this need me? What happened in the latest Run?
          </p>
          <p className="work-list-header__coverage">
            Delivered Artifacts are not shown until the Product API exposes them;
            this view does not infer them from messages or tool output.
          </p>
        </div>
        <button
          onClick={() => setShowNewWork(!showNewWork)}
          type="button"
          data-testid="new-work-cta"
          className="work-list-header__cta"
        >
          {showNewWork ? 'Hide' : 'New Work'}
        </button>
      </header>
      {showNewWork ? <NewWork /> : null}
      {state === 'loading' ? <WorkListLoading /> : null}
      {state === 'error' ? <WorkListError /> : null}
      {state === 'available' && works.length === 0 ? <WorkListEmpty showNewWork={showNewWork} onNewWork={() => setShowNewWork(true)} /> : null}
      {state === 'available' && works.length > 0 ? (
        <section aria-labelledby="work-list-heading" className="work-list-region">
          <div className="work-list-region__heading">
            <p className="work-list-region__eyebrow">Available Work</p>
            <h2 id="work-list-heading">Current Work</h2>
          </div>
          <ul data-testid="work-list" className="work-list">
            {works.map((work) => {
              const stateView = productStatePresentation(work.product_state);
              return (
                <li className="work-list-card" key={work.id}>
                  <div className="work-list-card__state">
                    <span
                      className={`work-state-pill work-state-pill--${work.product_state}`}
                      data-product-state={work.product_state}
                    >
                      {stateView.label}
                    </span>
                    <p>{stateView.description}</p>
                  </div>
                  <div className="work-list-card__identity">
                    <a href={`/works/${encodeURIComponent(work.id)}`}>
                      {work.title}
                    </a>
                    <p>{latestRunSummary(work)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </WorkShellFrame>
  );
}

export function WorkDetailShell({
  workId,
  tab,
  selectedRunId,
  selectedSessionIndex,
}: {
  readonly workId: string;
  readonly tab?: string;
  readonly selectedRunId?: string;
  readonly selectedSessionIndex?: string;
}) {
  const [state, setState] = useState<LoadState>('loading');
  const [detail, setDetail] = useState<WorkDetailData | null>(null);
  const activeTab = normalizeWorkTab(tab);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let firstLoad = true;

    const refresh = async () => {
      if (firstLoad) {
        setState('loading');
        setDetail(null);
      }
      try {
        const loaded = await loadWorkDetail(
          workId,
          selectedRunId,
          activeTab === 'definition' && !selectedRunId,
        );
        if (!active) return;
        setDetail(loaded);
        setState('available');
        firstLoad = false;
        if (loaded.run?.work_run.product_state === 'running')
          timer = setTimeout(() => void refresh(), 2_000);
      } catch (error) {
        if (!active) return;
        const isProjectionUnavailable = error instanceof ProductReadError && error.status === 503;
        if (isProjectionUnavailable && firstLoad) {
          setState('starting');
          timer = setTimeout(() => void refresh(), 2_000);
        } else if (isProjectionUnavailable) {
          timer = setTimeout(() => void refresh(), 2_000);
        } else {
          if (firstLoad) setState('error');
          else timer = setTimeout(() => void refresh(), 2_000);
        }
      }
    };

    void refresh();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [workId, selectedRunId, activeTab]);

  return (
    <WorkShellFrame testId="work-detail-shell">
      {state === 'loading' ? (
        <p className="work-detail-loading" aria-live="polite">
          Loading Work…
        </p>
      ) : null}
      {state === 'starting' ? (
        <p className="work-detail-loading" aria-live="polite">
          Run is starting…
        </p>
      ) : null}
      {state === 'error' ? (
        <section className="work-list-state work-list-state--error" role="alert">
          <p className="work-list-state__eyebrow">Couldn't load Work</p>
          <h2>The selected Work or Run is unavailable.</h2>
          <p>Return to My Work and choose an available Product Work record.</p>
        </section>
      ) : null}
      {detail ? (
        <WorkDetail
          activeTab={activeTab}
          data={detail}
          selectedRunId={selectedRunId}
          selectedSessionIndex={selectedSessionIndex}
        />
      ) : null}
    </WorkShellFrame>
  );
}

function WorkShellFrame({
  children,
  testId,
}: {
  readonly children: ReactNode;
  readonly testId: string;
}) {
  return (
    <div className="work-product-frame">
      <aside className="work-product-nav" aria-label="Product areas">
        <a className="work-product-brand" href="/">
          <span aria-hidden="true">◆</span>
          <span>Agent Server</span>
        </a>
        <nav aria-label="Primary product navigation">
          <a aria-current="page" className="work-product-nav__current" href="/">
            My Work
          </a>
          <span aria-disabled="true" className="work-product-nav__disabled">
            Artifacts <small>Not available</small>
          </span>
          <span aria-disabled="true" className="work-product-nav__disabled">
            Inbox <small>Not available</small>
          </span>
          <span aria-disabled="true" className="work-product-nav__disabled">
            Resource <small>Not available</small>
          </span>
        </nav>
        <div className="work-product-nav__foot">
          <a href="/chat">Compatibility Chat</a>
          <span>Runtime debugging only</span>
        </div>
      </aside>
      <main className="work-shell" data-testid={testId}>
        {children}
      </main>
    </div>
  );
}

function WorkDetail({
  activeTab,
  data,
  selectedRunId,
  selectedSessionIndex,
}: {
  readonly activeTab: WorkTab;
  readonly data: WorkDetailData;
  readonly selectedRunId?: string;
  readonly selectedSessionIndex?: string;
}) {
  const { work, run } = data;
  const runId = run?.work_run.id;
  const latestRunId = data.runs[0]?.id;
  const runContext = !run
    ? 'No Run recorded'
    : run.work_run.id === latestRunId
      ? 'Latest Run'
      : 'Historical Run';

  return (
    <>
      <p className="work-shell-breadcrumb"><a href="/">My Work</a> / {work.title}</p>
      <header className="work-detail-header work-detail-header--stacked">
        <div>
          <p className="work-shell-kicker">Work</p>
          <h1>{work.title}</h1>
          <p className="work-detail-header__summary">
            {runContext}
            {run
              ? ` · ${productStatePresentation(run.work_run.product_state).label}`
              : ''}
          </p>
          <p className="work-detail-surface-note">
            Define, run, inspect collaboration, and review through Product facts.
          </p>
        </div>
      </header>
      <RunTrigger workId={work.id} />
      <WorkTabs
        activeTab={activeTab}
        definitionRunId={undefined}
        runId={runId}
        workId={work.id}
      />
      {activeTab === 'overview' ? <OverviewPanel data={data} key={data.run?.work_run.id} /> : null}
      {activeTab === 'runs' ? <RunsPanel data={data} /> : null}
      {activeTab === 'transcript' ? (
        <TranscriptPanel
          data={data}
          selectedSessionIndex={selectedSessionIndex ? Number(selectedSessionIndex) : undefined}
        />
      ) : null}
      {activeTab === 'artifacts' ? <ArtifactsUnavailable /> : null}
      {activeTab === 'definition' ? (
        <DefinitionPanel
          currentWorkVersionId={work.definition_version_id}
          editable={
            !selectedRunId &&
            data.selectedDefinitionVersionId === work.definition_version_id
          }
          selectedVersionId={data.selectedDefinitionVersionId}
          version={data.definitionVersion}
          workDefinitionId={work.definition_id}
          workId={work.id}
        />
      ) : null}
    </>
  );
}

function WorkTabs({
  activeTab,
  definitionRunId,
  runId,
  workId,
}: {
  readonly activeTab: WorkTab;
  readonly definitionRunId: string | undefined;
  readonly runId: string | undefined;
  readonly workId: string;
}) {
  return (
    <nav className="work-tabs" aria-label="Work detail sections">
      {WORK_TABS.map((tab) => {
        const targetRunId = tab.id === 'definition' ? definitionRunId : runId;
        return (
          <a
            aria-current={activeTab === tab.id ? 'page' : undefined}
            href={workTabHref(workId, tab.id, targetRunId)}
            key={tab.id}
          >
            {tab.label}
          </a>
        );
      })}
    </nav>
  );
}

function RunRoleCards({ trace, workId, runId }: { readonly trace: AnchoredTrace; readonly workId: string; readonly runId: string }) {
  const [sessions, setSessions] = useState<readonly RoleSummary[] | null>(null);

  useEffect(() => {
    let active = true;
    loadRunRoleSummaries(workId, runId)
      .then((next) => {
        if (!active) return;
        setSessions(next);
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
              window.location.assign(`${workTabHref(workId, 'transcript', runId)}&session=${index}`);
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

function OverviewPanel({ data }: { readonly data: WorkDetailData }) {
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null);
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
      <RunRoleCards trace={trace} workId={data.work.id} runId={run.work_run.id} />
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

function TranscriptPanel({ data, selectedSessionIndex }: { readonly data: WorkDetailData; readonly selectedSessionIndex?: number }) {
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
    <section className="work-transcript-panel run-trace" data-testid="work-transcript-panel">
      <div className="run-trace__tabs" role="tablist" aria-label="Transcript views">
        {(['sessions', 'execution'] as const).map((item) => (
          <button
            aria-selected={view === item}
            className="run-trace__tab"
            key={item}
            onClick={() => setView(item)}
            role="tab"
            type="button"
          >
            {item === 'sessions' ? 'Session Transcripts' : 'Execution Transcript'}
          </button>
        ))}
      </div>
      {view === 'sessions' ? (
        <SessionTranscripts live={live} trace={data.trace} initialSelectedIndex={selectedSessionIndex} />
      ) : (
        <ExecutionTranscript live={live} trace={data.trace} />
      )}
    </section>
  );
}

function scrollTestIdIntoViewAfterRender(testId: string, fallbackTestId?: string) {
  // Two nested requestAnimationFrame calls: the first fires after React has
  // committed the state update that (may have) mounted the target element,
  // the second fires after the browser has painted that commit -- this is
  // the standard pattern for 'wait until a just-triggered state change has
  // actually reached the DOM' without guessing at a setTimeout delay.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-testid="${testId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (fallbackTestId) {
        document.querySelector(`[data-testid="${fallbackTestId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
          This review uses captured Product facts only. No assistant text or file
          is promoted to an Artifact.
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
          <ReviewFact label="Attempts" value={attemptCount} onClick={() => {
            onRequestTimelineView();
            scrollTestIdIntoViewAfterRender('trace-timeline');
          }} />
          <ReviewFact label="Rework" value={feedbackCount} onClick={() => {
            const reworkItem = trace.work_items.find((item) => item.attempts.length > 1);
            if (reworkItem && reworkItem.attempts[0]) onSelectAttempt(reworkItem.attempts[0].id);
            onRequestTimelineView();
            scrollTestIdIntoViewAfterRender('trace-timeline');
          }} />
          <ReviewFact label="Agent messages" value={messageCount} onClick={() => {
            onRequestTimelineView();
            scrollTestIdIntoViewAfterRender('timeline-messages', 'trace-timeline');
          }} />
          <ReviewFact label="MCP activities" value={trace.mcp_activities.length} />
        </dl>
      </div>
      <div className="work-review__map" data-testid="review-mini-map">
        <h3>Run Map</h3>
        <MapView selectedAttemptKey={selectedAttemptId} trace={trace} onSelect={(attemptId) => {
          onSelectAttempt(attemptId);
          onRequestTimelineView();
          scrollTestIdIntoViewAfterRender('trace-timeline');
        }} />
      </div>
      <div className="work-review__problems" data-testid="review-problems">
        <h3>Problems & capture gaps</h3>
        <ul>
          {reworkItems.length ? (
            <li>
              <strong>Rework:</strong>{' '}
              {reworkItems.map((item) => item.subject).join(', ')} ({reworkItems.length} item{reworkItems.length > 1 ? 's' : ''} required multiple Attempts)
            </li>
          ) : null}
          {mcpOnlyItems.length ? (
            <li>
              <strong>MCP-only coverage:</strong>{' '}
              {mcpOnlyItems.length} Work Item{mcpOnlyItems.length > 1 ? 's have' : ' has'} MCP activity but no observed Agent messages
            </li>
          ) : null}
          <li>
            <strong>Timeline scope:</strong>{' '}
            {trace.timeline_coverage.scope.replaceAll('_', ' ')}
            {trace.timeline_coverage.excluded_execution.length ? (
              <> — excluded: {trace.timeline_coverage.excluded_execution.map((e) => e.replaceAll('_', ' ')).join(', ')}</>
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
              <strong>{output.subject} (Attempt {output.attemptNo})</strong>
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
      <div className="work-review__fact--clickable" role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}>
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

function RunsPanel({ data }: { readonly data: WorkDetailData }) {
  if (data.runs.length === 0)
    return (
      <section className="work-detail-state">
        <p className="work-shell-kicker">Runs</p>
        <h2>No Run history yet.</h2>
      </section>
    );

  return (
    <section className="work-runs" aria-labelledby="work-runs-heading">
      <div className="work-section-heading">
        <p className="work-shell-kicker">Runs</p>
        <h2 id="work-runs-heading">Historical execution records</h2>
        <p>
          Each Run remains pinned to the exact immutable Definition version it
          used.
        </p>
      </div>
      <ol className="work-run-list">
        {data.runs.map((run, index) => {
          const selected = data.run?.work_run.id === run.id;
          const exactDefinition =
            data.definitionVersion?.id === run.definition_version_id
              ? definitionName(data.definitionVersion)
              : null;
          return (
            <li data-selected={selected ? 'true' : undefined} key={run.id}>
              <div className="work-run-list__identity">
                <strong>{index === 0 ? 'Latest Run' : 'Historical Run'}</strong>
                <time dateTime={run.created_at}>{formatTimestamp(run.created_at)}</time>
              </div>
              <div className="work-run-list__definition">
                <span>Definition</span>
                {exactDefinition ? (
                  <strong>{exactDefinition}</strong>
                ) : (
                  <code>{run.definition_version_id}</code>
                )}
              </div>
              {selected && data.run ? (
                <span
                  className={`work-state-pill work-state-pill--${data.run.work_run.product_state}`}
                >
                  {productStatePresentation(data.run.work_run.product_state).label}
                </span>
              ) : (
                <span className="work-run-list__quiet">Outcome loads on open</span>
              )}
              <a href={workTabHref(data.work.id, 'overview', run.id)}>
                {selected ? 'View Overview' : 'Open Run'}
              </a>
              <a href={workTabHref(data.work.id, 'definition', run.id)}>
                Definition used
              </a>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function ArtifactsUnavailable() {
  return (
    <section
      className="work-capability-unavailable"
      data-testid="artifacts-unavailable"
    >
      <p className="work-shell-kicker">Artifacts</p>
      <h2>Artifact delivery is not available in the current Product API.</h2>
      <p>
        This surface stays intentionally empty. Assistant text, arbitrary files,
        and tool output are not promoted to delivered Artifacts by the browser.
      </p>
    </section>
  );
}

function definitionName(
  version: ProductWorkDefinitionVersionResponse,
): string | null {
  const metadata = version.source.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
    return null;
  const name = (metadata as Record<string, unknown>).name;
  return typeof name === 'string' && name.length > 0 ? name : null;
}

function RunTrigger({ workId }: { readonly workId: string }) {
  const [state, setState] = useState<'idle' | 'starting' | 'error'>('idle');
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  async function handleRun() {
    setState('starting');
    setErrorDetail(null);
    try {
      const runId = await startWorkRun(workId);
      window.location.assign(workTabHref(workId, 'overview', runId));
    } catch (error) {
      setErrorDetail(error instanceof Error ? error.message : 'Please try again.');
      setState('error');
    }
  }

  return (
    <div className="work-run-trigger">
      <button
        disabled={state === 'starting'}
        onClick={() => void handleRun()}
        type="button"
      >
        {state === 'starting'
          ? 'Starting…'
          : state === 'error'
            ? 'Error — Retry'
            : 'Start Run'}
      </button>
      {state === 'error' ? (
        <p>
          Failed to start Run{errorDetail ? `: ${errorDetail}` : '. Please try again.'}
        </p>
      ) : null}
    </div>
  );
}


function WorkListLoading() {
  return (
    <section
      aria-live="polite"
      className="work-list-state work-list-state--loading"
      data-testid="work-list-loading"
    >
      <p className="work-list-state__eyebrow">Loading</p>
      <h2>Getting your Work records</h2>
      <p>We are retrieving the current Product Work projection.</p>
      <div aria-hidden="true" className="work-list-skeleton">
        <span />
        <span />
        <span />
      </div>
    </section>
  );
}

function WorkListError() {
  return (
    <section
      className="work-list-state work-list-state--error"
      data-testid="work-list-error"
      role="alert"
    >
      <p className="work-list-state__eyebrow">Couldn't load Work</p>
      <h2>Work records are temporarily unavailable.</h2>
      <p>
        This is a connection problem, not a statement about the status of any
        Work. Refresh the page to try again.
      </p>
    </section>
  );
}

function WorkListEmpty({ showNewWork, onNewWork }: {
  readonly showNewWork: boolean;
  readonly onNewWork: () => void;
}) {
  if (showNewWork) return null;
  return (
    <section
      aria-labelledby="work-list-empty-heading"
      className="work-list-state work-list-state--empty"
      data-testid="work-list-empty"
    >
      <p className="work-list-state__eyebrow">No Work records</p>
      <h2 id="work-list-empty-heading">Nothing is available yet.</h2>
      <p>When Work is created, it will appear here as the durable entry.</p>
      <button
        onClick={onNewWork}
        type="button"
        className="work-list-state__cta"
      >
        Create your first Work
      </button>
    </section>
  );
}
