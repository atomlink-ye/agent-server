'use client';

import { useEffect, useState, type ReactNode } from 'react';

import type {
  ProductRunTrace,
  ProductWorkDefinitionVersionResponse,
  ProductWorkRun,
  WorkListItem,
  WorkListResponse,
  WorkResponse,
  WorkRunListResponse,
  WorkRunSummary,
} from '@atomlink-ye/agent-server/product-contract';

import { DefinitionPanel } from '@/components/work/definition-panel';
import {
  WORK_TABS,
  formatTimestamp,
  latestRunSummary,
  normalizeWorkTab,
  productStatePresentation,
  resultCaptureLabel,
  workTabHref,
  type WorkTab,
} from '@/components/work/work-presentation';
import { RunTrace } from '@/features/run-trace/run-trace';
import './work-shell.css';
import './work-shell-mve.css';

type LoadState = 'loading' | 'available' | 'error';
type AnchoredRun = Extract<
  ProductWorkRun,
  { projection_status: 'internally_anchored' }
>;
type AnchoredTrace = Extract<
  ProductRunTrace,
  { projection_status: 'internally_anchored' }
>;

export function WorkListShell() {
  const [state, setState] = useState<LoadState>('loading');
  const [works, setWorks] = useState<readonly WorkListItem[]>([]);

  useEffect(() => {
    let active = true;
    void readJson<WorkListResponse>('/api/works')
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
        <p className="work-shell-kicker">My Work</p>
        <h1>My Work</h1>
        <p className="work-list-header__summary">
          Does this need me? What happened in the latest Run?
        </p>
        <p className="work-list-header__coverage">
          Delivered Artifacts are not shown until the Product API exposes them;
          this view does not infer them from messages or tool output.
        </p>
      </header>
      {state === 'loading' ? (
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
      ) : null}
      {state === 'error' ? (
        <section
          className="work-list-state work-list-state--error"
          data-testid="work-list-error"
          role="alert"
        >
          <p className="work-list-state__eyebrow">Couldn’t load Work</p>
          <h2>Work records are temporarily unavailable.</h2>
          <p>
            This is a connection problem, not a statement about the status of
            any Work. Refresh the page to try again.
          </p>
        </section>
      ) : null}
      {state === 'available' && works.length === 0 ? (
        <section
          aria-labelledby="work-list-empty-heading"
          className="work-list-state work-list-state--empty"
          data-testid="work-list-empty"
        >
          <p className="work-list-state__eyebrow">No Work records</p>
          <h2 id="work-list-empty-heading">Nothing is available yet.</h2>
          <p>When Work is created, it will appear here as the durable entry.</p>
        </section>
      ) : null}
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
}: {
  readonly workId: string;
  readonly tab?: string;
  readonly selectedRunId?: string;
}) {
  const [state, setState] = useState<LoadState>('loading');
  const [detail, setDetail] = useState<WorkDetailData | null>(null);
  const activeTab = normalizeWorkTab(tab);

  useEffect(() => {
    let active = true;
    setState('loading');
    setDetail(null);
    void loadWorkDetail(workId, selectedRunId)
      .then((loaded) => {
        if (!active) return;
        setDetail(loaded);
        setState('available');
      })
      .catch(() => {
        if (active) setState('error');
      });
    return () => {
      active = false;
    };
  }, [workId, selectedRunId]);

  return (
    <WorkShellFrame testId="work-detail-shell">
      {state === 'loading' ? (
        <p className="work-detail-loading" aria-live="polite">
          Loading Work…
        </p>
      ) : null}
      {state === 'error' ? (
        <section className="work-list-state work-list-state--error" role="alert">
          <p className="work-list-state__eyebrow">Couldn’t load Work</p>
          <h2>The selected Work or Run is unavailable.</h2>
          <p>Return to My Work and choose an available Product Work record.</p>
        </section>
      ) : null}
      {detail ? <WorkDetail activeTab={activeTab} data={detail} /> : null}
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
}: {
  readonly activeTab: WorkTab;
  readonly data: WorkDetailData;
}) {
  const { work, run } = data;
  const selectedRunId = run?.work_run.id;
  const latestRunId = data.runs[0]?.id;
  const runContext = !run
    ? 'No Run recorded'
    : run.work_run.id === latestRunId
      ? 'Latest Run'
      : 'Historical Run';

  return (
    <>
      <p className="work-shell-breadcrumb">My Work / {work.title}</p>
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
            Product Work/Run reads with an explicit Start Run control.
          </p>
        </div>
      </header>
      <RunTrigger workId={work.id} />
      <WorkTabs
        activeTab={activeTab}
        runId={selectedRunId}
        workId={work.id}
      />
      {activeTab === 'overview' ? <OverviewPanel data={data} /> : null}
      {activeTab === 'runs' ? <RunsPanel data={data} /> : null}
      {activeTab === 'artifacts' ? <ArtifactsUnavailable /> : null}
      {activeTab === 'definition' ? (
        <DefinitionPanel
          selectedVersionId={data.selectedDefinitionVersionId}
          version={data.definitionVersion}
        />
      ) : null}
    </>
  );
}

function WorkTabs({
  activeTab,
  runId,
  workId,
}: {
  readonly activeTab: WorkTab;
  readonly runId: string | undefined;
  readonly workId: string;
}) {
  return (
    <nav className="work-tabs" aria-label="Work detail sections">
      {WORK_TABS.map((tab) => (
        <a
          aria-current={activeTab === tab.id ? 'page' : undefined}
          href={workTabHref(workId, tab.id, runId)}
          key={tab.id}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  );
}

function OverviewPanel({ data }: { readonly data: WorkDetailData }) {
  if (!data.run || !data.trace)
    return (
      <section className="work-detail-state" data-testid="work-no-runs">
        <p className="work-shell-kicker">Overview</p>
        <h2>No Run has been recorded yet.</h2>
        <p>The Work exists, but there is no execution history to project.</p>
      </section>
    );

  const outcome = data.run.work_run.result_summary;
  const stateView = productStatePresentation(data.run.work_run.product_state);
  return (
    <section className="work-overview" data-testid="work-overview">
      <div className="work-overview__summary">
        <span
          className={`work-state-pill work-state-pill--${data.run.work_run.product_state}`}
          data-testid="outcome-product-state"
        >
          {stateView.label}
        </span>
        <div>
          <p className="work-shell-kicker">Latest recorded outcome</p>
          <h2>
            {outcome ??
              resultCaptureLabel(data.run.work_run.result_capture_status)}
          </h2>
          <p data-testid="attention-basis">{stateView.description}</p>
        </div>
      </div>
      <RunTrace trace={data.trace} />
    </section>
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
          Each row is a Product WorkRun. Open one to inspect the same Run in
          Overview without falling back to technical execution APIs.
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
                <time dateTime={run.created_at}>
                  {formatTimestamp(run.created_at)}
                </time>
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
                <span className="work-run-list__quiet">
                  Outcome loads on open
                </span>
              )}
              <a href={workTabHref(data.work.id, 'overview', run.id)}>
                {selected ? 'View Overview' : 'Open Run'}
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

type WorkDetailData = {
  readonly work: WorkResponse;
  readonly runs: readonly WorkRunSummary[];
  readonly run: AnchoredRun | null;
  readonly trace: AnchoredTrace | null;
  readonly selectedDefinitionVersionId: string;
  readonly definitionVersion: ProductWorkDefinitionVersionResponse | null;
};

async function loadWorkDetail(
  workId: string,
  selectedRunId?: string,
): Promise<WorkDetailData> {
  const encodedId = encodeURIComponent(workId);
  const [workResponse, runsResponse] = await Promise.all([
    readJson<{ work: WorkResponse }>(`/api/works/${encodedId}`),
    readJson<WorkRunListResponse>(`/api/works/${encodedId}/runs`),
  ]);
  const runs = runsResponse.work_runs;
  const selectedSummary = selectedRunId
    ? runs.find((run) => run.id === selectedRunId)
    : runs[0];
  if (selectedRunId && !selectedSummary)
    throw new Error('The selected Product WorkRun is not available.');

  const selectedDefinitionVersionId =
    selectedSummary?.definition_version_id ??
    workResponse.work.definition_version_id;
  const definitionPromise = readOptionalJson<{
    version: ProductWorkDefinitionVersionResponse;
  }>(
    `/api/work-definition-versions/${encodeURIComponent(selectedDefinitionVersionId)}`,
  );
  if (!selectedSummary)
    return {
      work: workResponse.work,
      runs,
      run: null,
      trace: null,
      selectedDefinitionVersionId,
      definitionVersion: (await definitionPromise)?.version ?? null,
    };

  const runPath = `/api/works/${encodedId}/runs/${encodeURIComponent(selectedSummary.id)}`;
  const [run, trace, definitionResponse] = await Promise.all([
    readJson<ProductWorkRun>(runPath),
    readJson<ProductRunTrace>(`${runPath}/trace`),
    definitionPromise,
  ]);
  if (!isAnchoredRun(run) || !isAnchoredTrace(trace))
    throw new Error('The Product WorkRun projection was not captured.');
  return {
    work: workResponse.work,
    runs,
    run,
    trace,
    selectedDefinitionVersionId,
    definitionVersion: definitionResponse?.version ?? null,
  };
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

function isAnchoredRun(value: ProductWorkRun): value is AnchoredRun {
  return (
    'projection_status' in value &&
    value.projection_status === 'internally_anchored'
  );
}

function isAnchoredTrace(value: ProductRunTrace): value is AnchoredTrace {
  return (
    'projection_status' in value &&
    value.projection_status === 'internally_anchored'
  );
}

function RunTrigger({ workId }: { readonly workId: string }) {
  const [state, setState] = useState<
    'idle' | 'starting' | 'started' | 'error'
  >('idle');

  async function handleRun() {
    setState('starting');
    try {
      const response = await fetch(
        `/api/works/${encodeURIComponent(workId)}/runs`,
        {
          method: 'POST',
          cache: 'no-store',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ trigger_kind: 'manual' }),
        },
      );
      if (!response.ok) {
        setState('error');
        return;
      }
      setState('started');
    } catch {
      setState('error');
    }
  }

  return (
    <div className="work-run-trigger">
      <button
        disabled={state === 'starting' || state === 'started'}
        onClick={() => void handleRun()}
        type="button"
      >
        {state === 'idle'
          ? 'Start Run'
          : state === 'starting'
            ? 'Starting…'
            : state === 'started'
              ? 'Run Started'
              : 'Error — Retry'}
      </button>
      {state === 'error' && <p>Failed to start Run. Please try again.</p>}
    </div>
  );
}

async function readJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    method: 'GET',
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Product read failed.');
  return (await response.json()) as T;
}

async function readOptionalJson<T>(path: string): Promise<T | null> {
  const response = await fetch(path, {
    method: 'GET',
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) return null;
  return (await response.json()) as T;
}
