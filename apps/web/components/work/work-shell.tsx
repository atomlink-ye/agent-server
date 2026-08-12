'use client';

import { useEffect, useState } from 'react';

import type {
  ProductRunTrace,
  ProductWorkRun,
  WorkListResponse,
  WorkResponse,
  WorkRunListResponse,
} from '@atomlink-ye/agent-server/product-contract';

type LoadState = 'loading' | 'available' | 'error';

export function WorkListShell() {
  const [state, setState] = useState<LoadState>('loading');
  const [works, setWorks] = useState<readonly WorkResponse[]>([]);

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
    <main className="work-shell" data-testid="work-list-shell">
      <p className="work-shell-kicker">Work-first surface · read only</p>
      <h1>Works</h1>
      <p>This is a read-only Work-first surface.</p>
      <p>Controls are explicitly unavailable.</p>
      {state === 'loading' ? <p>Loading Works…</p> : null}
      {state === 'error' ? (
        <p role="alert">Work data could not be loaded.</p>
      ) : null}
      {state === 'available' ? (
        <ul data-testid="work-list">
          {works.map((work) => (
            <li key={work.id}>
              <a href={`/works/${encodeURIComponent(work.id)}`}>{work.title}</a>
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}

export function WorkDetailShell({ workId }: { readonly workId: string }) {
  const [state, setState] = useState<LoadState>('loading');
  const [detail, setDetail] = useState<WorkDetailData | null>(null);

  useEffect(() => {
    let active = true;
    void loadWorkDetail(workId)
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
  }, [workId]);

  return (
    <main className="work-shell" data-testid="work-detail-shell">
      <p className="work-shell-kicker">Work-first surface · read only</p>
      {state === 'loading' ? <p>Loading Work…</p> : null}
      {state === 'error' ? (
        <p role="alert">Work data could not be loaded.</p>
      ) : null}
      {detail ? <WorkDetail data={detail} /> : null}
    </main>
  );
}

function WorkDetail({ data }: { readonly data: WorkDetailData }) {
  const { work, run, trace } = data;
  const attempts = workItemsWithAttempts(trace.work_items);
  const longest = longestCapturedAttempt(attempts);
  const notCapturedFacts = collectNotCapturedFacts(run, trace, attempts);

  return (
    <>
      <h1>{work.title}</h1>
      <p data-testid="work-id">Work ID: {work.id}</p>
      <p>This is a read-only Work-first surface.</p>
      <p>Controls are explicitly unavailable.</p>

      <section aria-labelledby="outcome-heading">
        <h2 id="outcome-heading">Outcome</h2>
        <p data-testid="outcome-product-state">{run.work_run.product_state}</p>
        <p data-testid="attention-basis">
          Attention basis: {run.work_run.attention_reason ?? 'not specified'};
          completion decision: {run.work_run.completion_decision_availability}
        </p>
      </section>

      <section aria-labelledby="result-heading">
        <h2 id="result-heading">Latest result</h2>
        <p data-testid="latest-result-summary">
          Summary: {run.work_run.result_summary ?? 'not captured'}
        </p>
        <p data-testid="latest-result-capture-status">
          Capture status: {run.work_run.result_capture_status}
        </p>
        <p data-testid="latest-result-problem-kind">
          Problem: {run.work_run.problem_kind ?? 'not specified'}
        </p>
      </section>

      <section aria-labelledby="attempt-heading">
        <h2 id="attempt-heading">Work item attempts</h2>
        {attempts.length === 0 ? <p>No WorkItem attempts captured.</p> : null}
        {attempts.map(({ workItem, attempt }) => (
          <article key={attempt.id} data-testid="work-item-attempt">
            <h3>{workItem.subject}</h3>
            <p data-testid="attempt-id">Attempt ID: {attempt.id}</p>
            <p data-testid="attempt-no">Attempt no: {attempt.attempt_no}</p>
          </article>
        ))}
        <p data-testid="longest-attempt">
          Longest captured attempt:{' '}
          {longest
            ? `${longest.id} · ${longest.duration_ms} ms`
            : 'not captured'}
        </p>
      </section>

      <section aria-labelledby="capture-heading">
        <h2 id="capture-heading">Capture facts</h2>
        {notCapturedFacts.length > 0 ? (
          <ul data-testid="not-captured-facts">
            {notCapturedFacts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        ) : (
          <p data-testid="not-captured-facts">No capture gaps recorded.</p>
        )}
      </section>

      {trace.timeline_coverage.completeness === 'mcp_only' ? (
        <p data-testid="mcp-only-warning" role="status">
          Coverage warning: MCP-only; direct shell, direct file edit, and other
          non-MCP execution are excluded.
        </p>
      ) : null}

      <section aria-labelledby="chat-heading">
        <h2 id="chat-heading">Chat detail</h2>
        {trace.mcp_activities.map((activity) => (
          <a
            key={activity.activity_id}
            data-testid="chat-detail-link"
            href={activity.chat_detail.path}
          >
            Chat detail {activity.activity_id}
          </a>
        ))}
      </section>
    </>
  );
}

type WorkDetailData = {
  readonly work: WorkResponse;
  readonly run: Extract<
    ProductWorkRun,
    { projection_status: 'internally_anchored' }
  >;
  readonly trace: Extract<
    ProductRunTrace,
    { projection_status: 'internally_anchored' }
  >;
};

async function loadWorkDetail(workId: string): Promise<WorkDetailData> {
  const encodedId = encodeURIComponent(workId);
  const workResponse = await readJson<{ work: WorkResponse }>(
    `/api/works/${encodedId}`,
  );
  const runsResponse = await readJson<WorkRunListResponse>(
    `/api/works/${encodedId}/runs`,
  );
  const finalRun = [...runsResponse.work_runs].sort(compareWorkRuns).at(-1);
  if (!finalRun) throw new Error('No WorkRun is available.');

  const runPath = `/api/works/${encodedId}/runs/${encodeURIComponent(finalRun.id)}`;
  const [run, trace] = await Promise.all([
    readJson<ProductWorkRun>(runPath),
    readJson<ProductRunTrace>(`${runPath}/trace`),
  ]);
  if (!isAnchoredRun(run) || !isAnchoredTrace(trace))
    throw new Error('The WorkRun projection was not captured.');
  return { work: workResponse.work, run, trace };
}

function compareWorkRuns(
  left: WorkRunListResponse['work_runs'][number],
  right: WorkRunListResponse['work_runs'][number],
): number {
  return (
    left.created_at.localeCompare(right.created_at) ||
    left.id.localeCompare(right.id)
  );
}

function isAnchoredRun(value: ProductWorkRun): value is WorkDetailData['run'] {
  return (
    'projection_status' in value &&
    value.projection_status === 'internally_anchored'
  );
}

function isAnchoredTrace(
  value: ProductRunTrace,
): value is WorkDetailData['trace'] {
  return (
    'projection_status' in value &&
    value.projection_status === 'internally_anchored'
  );
}

type ProductWorkItem = ProductRunTrace extends infer Trace
  ? Trace extends { work_items: readonly (infer Item)[] }
    ? Item
    : never
  : never;

function workItemsWithAttempts(workItems: readonly ProductWorkItem[]) {
  return workItems.flatMap((workItem) =>
    workItem.attempts.map((attempt) => ({ workItem, attempt })),
  );
}

function longestCapturedAttempt(
  attempts: ReturnType<typeof workItemsWithAttempts>,
) {
  return attempts
    .map(({ attempt }) => attempt)
    .filter(
      (attempt) =>
        attempt.timing_capture_status === 'captured' &&
        attempt.duration_ms !== null,
    )
    .sort((left, right) => right.duration_ms! - left.duration_ms!)[0];
}

function collectNotCapturedFacts(
  run: WorkDetailData['run'],
  trace: WorkDetailData['trace'],
  attempts: ReturnType<typeof workItemsWithAttempts>,
): readonly string[] {
  const facts: string[] = [];
  if (run.work_run.product_state === 'not_captured')
    facts.push('WorkRun product state is not_captured.');
  if (run.work_run.result_capture_status === 'not_captured')
    facts.push('Latest result is not_captured.');
  if (run.work_run.completion_decision_availability === 'not_captured')
    facts.push('Completion decision is not_captured.');
  if (
    attempts.some(
      ({ attempt }) => attempt.timing_capture_status === 'not_captured',
    )
  )
    facts.push('At least one attempt timing span is not_captured.');
  if (trace.timeline_coverage.completeness === 'mcp_only')
    facts.push('Trace coverage is explicitly MCP-only.');
  return facts;
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
