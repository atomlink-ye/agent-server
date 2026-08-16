'use client';

import { useEffect, useState, type ReactNode } from 'react';

import type {
  ProductRunTrace,
  ProductWorkRun,
  WorkDefinitionResponse,
  WorkListItem,
  WorkListResponse,
  WorkResponse,
  WorkRunListResponse,
  WorkRunSummary,
} from '@atomlink-ye/agent-server/product-contract';

import { RunTrace } from '@/features/run-trace/run-trace';
import './work-shell.css';
import './work-shell-mve.css';

type LoadState = 'loading' | 'available' | 'error';
type WorkTab = 'overview' | 'runs' | 'artifacts' | 'definition';
type AnchoredRun = Extract<
  ProductWorkRun,
  { projection_status: 'internally_anchored' }
>;
type AnchoredTrace = Extract<
  ProductRunTrace,
  { projection_status: 'internally_anchored' }
>;

const WORK_TABS: readonly { readonly id: WorkTab; readonly label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'runs', label: 'Runs' },
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'definition', label: 'Definition' },
];

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
            {run ? ` · ${productStatePresentation(run.work_run.product_state).label}` : ''}
          </p>
        </div>
      </header>
      <WorkTabs
        activeTab={activeTab}
        runId={selectedRunId}
        workId={work.id}
      />
      {activeTab === 'overview' ? <OverviewPanel data={data} /> : null}
      {activeTab === 'runs' ? <RunsPanel data={data} /> : null}
      {activeTab === 'artifacts' ? <ArtifactsUnavailable /> : null}
      {activeTab === 'definition' ? <DefinitionPanel data={data} /> : null}
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
        >
          {stateView.label}
        </span>
        <div>
          <p className="work-shell-kicker">Latest recorded outcome</p>
          <h2>{outcome ?? resultCaptureLabel(data.run.work_run.result_capture_status)}</h2>
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
            data.definition?.version.id === run.definition_version_id
              ? data.definition.version.name
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
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function ArtifactsUnavailable() {
  return (
    <section className="work-capability-unavailable" data-testid="artifacts-unavailable">
      <p className="work-shell-kicker">Artifacts</p>
      <h2>Artifact delivery is not available in the current Product API.</h2>
      <p>
        This surface stays intentionally empty. Assistant text, arbitrary files,
        and tool output are not promoted to delivered Artifacts by the browser.
      </p>
    </section>
  );
}

function DefinitionPanel({ data }: { readonly data: WorkDetailData }) {
  const selectedVersionId =
    data.run?.work_run.definition_version_id ?? data.work.definition_version_id;
  if (!data.definition)
    return (
      <section className="work-capability-unavailable" data-testid="definition-unavailable">
        <p className="work-shell-kicker">Definition</p>
        <h2>The Definition body could not be loaded.</h2>
        <p>The selected Product version reference is:</p>
        <code className="work-definition-ref">{selectedVersionId}</code>
      </section>
    );

  const exactVersion = data.definition.version.id === selectedVersionId;
  if (!exactVersion)
    return (
      <section className="work-definition" data-testid="definition-historical-unavailable">
        <div className="work-section-heading">
          <p className="work-shell-kicker">Definition</p>
          <h2>Historical Definition body unavailable</h2>
          <p>
            The selected Run used a Definition version that is no longer the
            Work’s current Definition. The accepted Product API currently
            exposes the current Definition body only, so this UI does not fall
            back to internal collaboration APIs.
          </p>
        </div>
        <dl className="work-definition__facts">
          <Fact label="Selected Run version" value={selectedVersionId} code />
          <Fact
            label="Current Definition"
            value={data.definition.version.name}
          />
        </dl>
      </section>
    );

  const version = data.definition.version;
  return (
    <section className="work-definition" data-testid="definition-viewer">
      <div className="work-section-heading">
        <p className="work-shell-kicker">Definition</p>
        <h2>{version.name}</h2>
        <p>Read-only Product projection used by the selected Run.</p>
      </div>
      <dl className="work-definition__facts">
        <Fact label="Status" value={humanize(version.status)} />
        <Fact label="Version reference" value={version.id} code />
        <Fact
          label="Description"
          value={version.description ?? 'No description captured'}
        />
        <Fact label="Lead Agent" value={version.spec.lead.name} />
        <Fact
          label="Lead Agent version"
          value={version.spec.lead.agentVersionId}
          code
        />
        <Fact
          label="Environment version"
          value={version.environment_version_id}
          code
        />
      </dl>
      <div className="work-definition__agents">
        <h3>Agents</h3>
        <ul>
          {version.spec.roster.map((agent) => (
            <li key={agent.name}>
              <strong>{agent.name}</strong>
              <code>{agent.agentVersionId}</code>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Fact({
  label,
  value,
  code = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly code?: boolean;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{code ? <code>{value}</code> : value}</dd>
    </div>
  );
}

type WorkDetailData = {
  readonly work: WorkResponse;
  readonly runs: readonly WorkRunSummary[];
  readonly run: AnchoredRun | null;
  readonly trace: AnchoredTrace | null;
  readonly definition: WorkDefinitionResponse | null;
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
  const runs = [...runsResponse.work_runs].sort(compareWorkRunsNewestFirst);
  const selectedSummary = selectedRunId
    ? runs.find((run) => run.id === selectedRunId)
    : runs[0];
  if (selectedRunId && !selectedSummary)
    throw new Error('The selected Product WorkRun is not available.');

  const definitionPromise = readOptionalJson<WorkDefinitionResponse>(
    `/api/works/${encodedId}/definition`,
  );
  if (!selectedSummary)
    return {
      work: workResponse.work,
      runs,
      run: null,
      trace: null,
      definition: await definitionPromise,
    };

  const runPath = `/api/works/${encodedId}/runs/${encodeURIComponent(selectedSummary.id)}`;
  const [run, trace, definition] = await Promise.all([
    readJson<ProductWorkRun>(runPath),
    readJson<ProductRunTrace>(`${runPath}/trace`),
    definitionPromise,
  ]);
  if (!isAnchoredRun(run) || !isAnchoredTrace(trace))
    throw new Error('The Product WorkRun projection was not captured.');
  return { work: workResponse.work, runs, run, trace, definition };
}

function compareWorkRunsNewestFirst(
  left: WorkRunSummary,
  right: WorkRunSummary,
): number {
  return (
    right.created_at.localeCompare(left.created_at) ||
    right.id.localeCompare(left.id)
  );
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

function normalizeWorkTab(value: string | undefined): WorkTab {
  return WORK_TABS.some((tab) => tab.id === value)
    ? (value as WorkTab)
    : 'overview';
}

function workTabHref(workId: string, tab: WorkTab, runId?: string) {
  const query = new URLSearchParams();
  if (tab !== 'overview') query.set('tab', tab);
  if (runId) query.set('run', runId);
  const encodedWorkId = encodeURIComponent(workId);
  const suffix = query.toString();
  return `/works/${encodedWorkId}${suffix ? `?${suffix}` : ''}`;
}

function productStatePresentation(state: WorkListItem['product_state']) {
  switch (state) {
    case 'running':
      return { label: 'Running', description: 'The latest Run is active.' };
    case 'needs_you':
      return {
        label: 'Needs You',
        description: 'Your action is required before Work can safely progress.',
      };
    case 'complete':
      return {
        label: 'Complete',
        description: 'The latest Run reached a completed product state.',
      };
    case 'problem':
      return {
        label: 'Problem',
        description: 'The latest Run needs review before Work can progress.',
      };
    case 'not_captured':
      return {
        label: 'State unavailable',
        description: 'Product state was not captured.',
      };
  }
}

function latestRunSummary(work: WorkListItem) {
  const latest = work.latest_run_summary;
  if (!latest) return 'No Run has been recorded yet.';
  if (latest.result_summary !== null) return latest.result_summary;
  return resultCaptureLabel(latest.result_capture_status);
}

function resultCaptureLabel(status: string) {
  switch (status) {
    case 'redacted':
      return 'Result was captured but is redacted.';
    case 'not_present':
      return 'No result summary is present.';
    case 'not_captured':
      return 'Result capture is unavailable.';
    default:
      return 'Result summary captured.';
  }
}

function formatTimestamp(value: string) {
  return `${value.replace('T', ' ').slice(0, 16)} UTC`;
}

function humanize(value: string) {
  return value.replaceAll('_', ' ');
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
